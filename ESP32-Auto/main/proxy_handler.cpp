#include "esp_log.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "lwip/sockets.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "freertos/queue.h"
#include "common.h"
#include "usb_gadget.h"

static const char *TAG = "PROXY_HANDLER";

// Proxy configuration
#define PROXY_BUFFER_SIZE        4096
#define PROXY_TCP_PORT           5277
#define PROXY_TASK_STACK_SIZE    8192
#define PROXY_TASK_PRIORITY      12
#define PROXY_QUEUE_SIZE         10
#define PROXY_CONNECTION_TIMEOUT  5000

// Proxy state
static bool g_proxy_active = false;
static TaskHandle_t g_proxy_task_handle = NULL;
static TaskHandle_t g_usb_task_handle = NULL;
static TaskHandle_t g_tcp_task_handle = NULL;
static SemaphoreHandle_t g_proxy_mutex = NULL;
static QueueHandle_t g_usb_to_tcp_queue = NULL;
static QueueHandle_t g_tcp_to_usb_queue = NULL;
static int g_server_socket = -1;
static int g_client_socket = -1;

// Data packet structure
typedef struct {
    uint8_t data[PROXY_BUFFER_SIZE];
    size_t length;
} proxy_packet_t;

// Proxy context
typedef struct {
    bool running;
    uint32_t usb_bytes_sent;
    uint32_t usb_bytes_received;
    uint32_t tcp_bytes_sent;
    uint32_t tcp_bytes_received;
} proxy_context_t;

static proxy_context_t g_proxy_context = {0};

// Function prototypes
static void proxy_task(void *pvParameters);
static void usb_forward_task(void *pvParameters);
static void tcp_forward_task(void *pvParameters);
static status_t proxy_create_server_socket(void);
static status_t proxy_wait_for_client(void);
static void proxy_cleanup_connection(void);
static status_t proxy_forward_usb_to_tcp(void);
static status_t proxy_forward_tcp_to_usb(void);

status_t proxy_init(void) {
    ESP_LOGI(TAG, "Initializing proxy handler");
    
    g_proxy_active = false;
    g_proxy_task_handle = NULL;
    g_usb_task_handle = NULL;
    g_tcp_task_handle = NULL;
    g_server_socket = -1;
    g_client_socket = -1;
    
    memset(&g_proxy_context, 0, sizeof(proxy_context_t));
    
    // Create mutex for thread safety
    g_proxy_mutex = xSemaphoreCreateMutex();
    if (g_proxy_mutex == NULL) {
        ESP_LOGE(TAG, "Failed to create proxy mutex");
        return STATUS_ERROR_MEMORY;
    }
    
    // Create queues for data forwarding
    g_usb_to_tcp_queue = xQueueCreate(PROXY_QUEUE_SIZE, sizeof(proxy_packet_t));
    if (g_usb_to_tcp_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create USB to TCP queue");
        vSemaphoreDelete(g_proxy_mutex);
        return STATUS_ERROR_MEMORY;
    }
    
    g_tcp_to_usb_queue = xQueueCreate(PROXY_QUEUE_SIZE, sizeof(proxy_packet_t));
    if (g_tcp_to_usb_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create TCP to USB queue");
        vQueueDelete(g_usb_to_tcp_queue);
        vSemaphoreDelete(g_proxy_mutex);
        return STATUS_ERROR_MEMORY;
    }
    
    ESP_LOGI(TAG, "Proxy handler initialized");
    return STATUS_OK;
}

static status_t proxy_create_server_socket(void) {
    struct sockaddr_in server_addr;
    
    // Create socket
    g_server_socket = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
    if (g_server_socket < 0) {
        ESP_LOGE(TAG, "Failed to create socket: errno %d", errno);
        return STATUS_ERROR_CONNECTION;
    }
    
    // Set socket options
    int opt = 1;
    setsockopt(g_server_socket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    
    // Bind socket
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(PROXY_TCP_PORT);
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);
    
    if (bind(g_server_socket, (struct sockaddr*)&server_addr, sizeof(server_addr)) < 0) {
        ESP_LOGE(TAG, "Failed to bind socket: errno %d", errno);
        close(g_server_socket);
        g_server_socket = -1;
        return STATUS_ERROR_CONNECTION;
    }
    
    // Listen for connections
    if (listen(g_server_socket, 1) < 0) {
        ESP_LOGE(TAG, "Failed to listen: errno %d", errno);
        close(g_server_socket);
        g_server_socket = -1;
        return STATUS_ERROR_CONNECTION;
    }
    
    ESP_LOGI(TAG, "Proxy server listening on port %d", PROXY_TCP_PORT);
    return STATUS_OK;
}

static status_t proxy_wait_for_client(void) {
    struct sockaddr_in client_addr;
    socklen_t client_addr_len = sizeof(client_addr);
    
    ESP_LOGI(TAG, "Waiting for TCP client connection...");
    
    // Accept connection with timeout
    fd_set read_fds;
    FD_ZERO(&read_fds);
    FD_SET(g_server_socket, &read_fds);
    
    struct timeval timeout;
    timeout.tv_sec = PROXY_CONNECTION_TIMEOUT / 1000;
    timeout.tv_usec = (PROXY_CONNECTION_TIMEOUT % 1000) * 1000;
    
    int select_ret = select(g_server_socket + 1, &read_fds, NULL, NULL, &timeout);
    if (select_ret <= 0) {
        ESP_LOGE(TAG, "No client connected within timeout");
        return STATUS_ERROR_CONNECTION;
    }
    
    g_client_socket = accept(g_server_socket, (struct sockaddr*)&client_addr, &client_addr_len);
    if (g_client_socket < 0) {
        ESP_LOGE(TAG, "Failed to accept connection: errno %d", errno);
        return STATUS_ERROR_CONNECTION;
    }
    
    ESP_LOGI(TAG, "Client connected from %s:%d", 
             inet_ntoa(client_addr.sin_addr), ntohs(client_addr.sin_port));
    
    // Set client socket options
    int opt = 1;
    setsockopt(g_client_socket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    
    return STATUS_OK;
}

static void proxy_cleanup_connection(void) {
    if (g_client_socket >= 0) {
        close(g_client_socket);
        g_client_socket = -1;
        ESP_LOGI(TAG, "Client connection closed");
    }
}

static status_t proxy_forward_usb_to_tcp(void) {
    uint8_t buffer[PROXY_BUFFER_SIZE];
    size_t transferred;
    
    // Read from USB
    esp_err_t ret = usb_bulk_transfer(USB_EP1_OUT_ADDR, buffer, PROXY_BUFFER_SIZE, &transferred);
    if (ret == ESP_OK && transferred > 0) {
        ESP_LOGD(TAG, "Read %d bytes from USB", transferred);
        
        // Send to TCP
        if (g_client_socket >= 0) {
            int sent = send(g_client_socket, buffer, transferred, MSG_NOSIGNAL);
            if (sent > 0) {
                g_proxy_context.tcp_bytes_sent += sent;
                ESP_LOGD(TAG, "Sent %d bytes to TCP", sent);
            } else if (sent < 0) {
                ESP_LOGE(TAG, "Failed to send to TCP: errno %d", errno);
                return STATUS_ERROR_CONNECTION;
            }
        }
        
        g_proxy_context.usb_bytes_received += transferred;
    }
    
    return STATUS_OK;
}

static status_t proxy_forward_tcp_to_usb(void) {
    uint8_t buffer[PROXY_BUFFER_SIZE];
    
    if (g_client_socket < 0) {
        return STATUS_OK;  // No client connected
    }
    
    // Read from TCP
    int received = recv(g_client_socket, buffer, PROXY_BUFFER_SIZE, MSG_NOSIGNAL);
    if (received > 0) {
        ESP_LOGD(TAG, "Read %d bytes from TCP", received);
        
        // Send to USB
        size_t transferred;
        esp_err_t ret = usb_bulk_transfer(USB_EP1_IN_ADDR, buffer, received, &transferred);
        if (ret == ESP_OK) {
            g_proxy_context.usb_bytes_sent += transferred;
            ESP_LOGD(TAG, "Sent %d bytes to USB", transferred);
        }
        
        g_proxy_context.tcp_bytes_received += received;
    } else if (received < 0) {
        ESP_LOGE(TAG, "Failed to receive from TCP: errno %d", errno);
        return STATUS_ERROR_CONNECTION;
    } else if (received == 0) {
        ESP_LOGI(TAG, "TCP client disconnected");
        return STATUS_ERROR_CONNECTION;
    }
    
    return STATUS_OK;
}

static void usb_forward_task(void *pvParameters) {
    ESP_LOGI(TAG, "USB forward task started");
    
    while (g_proxy_context.running) {
        if (proxy_forward_usb_to_tcp() != STATUS_OK) {
            ESP_LOGE(TAG, "USB to TCP forwarding failed");
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(1));  // Small delay to prevent busy loop
    }
    
    ESP_LOGI(TAG, "USB forward task stopped");
    vTaskDelete(NULL);
}

static void tcp_forward_task(void *pvParameters) {
    ESP_LOGI(TAG, "TCP forward task started");
    
    while (g_proxy_context.running) {
        if (proxy_forward_tcp_to_usb() != STATUS_OK) {
            ESP_LOGE(TAG, "TCP to USB forwarding failed");
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(1));  // Small delay to prevent busy loop
    }
    
    ESP_LOGI(TAG, "TCP forward task stopped");
    vTaskDelete(NULL);
}

static void proxy_task(void *pvParameters) {
    ESP_LOGI(TAG, "Main proxy task started");
    
    g_proxy_context.running = true;
    
    while (g_proxy_context.running && g_proxy_active) {
        // Create server socket
        if (proxy_create_server_socket() != STATUS_OK) {
            ESP_LOGE(TAG, "Failed to create server socket, retrying...");
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        
        // Wait for client connection
        if (proxy_wait_for_client() != STATUS_OK) {
            ESP_LOGE(TAG, "Failed to wait for client, retrying...");
            proxy_cleanup_connection();
            close(g_server_socket);
            g_server_socket = -1;
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        
        // Start forwarding tasks
        BaseType_t ret = xTaskCreate(
            usb_forward_task,
            "usb_forward",
            PROXY_TASK_STACK_SIZE / 2,
            NULL,
            PROXY_TASK_PRIORITY,
            &g_usb_task_handle
        );
        
        if (ret != pdPASS) {
            ESP_LOGE(TAG, "Failed to create USB forward task");
            proxy_cleanup_connection();
            close(g_server_socket);
            g_server_socket = -1;
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        
        ret = xTaskCreate(
            tcp_forward_task,
            "tcp_forward",
            PROXY_TASK_STACK_SIZE / 2,
            NULL,
            PROXY_TASK_PRIORITY,
            &g_tcp_task_handle
        );
        
        if (ret != pdPASS) {
            ESP_LOGE(TAG, "Failed to create TCP forward task");
            if (g_usb_task_handle) {
                vTaskDelete(g_usb_task_handle);
                g_usb_task_handle = NULL;
            }
            proxy_cleanup_connection();
            close(g_server_socket);
            g_server_socket = -1;
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        
        // Monitor connection
        while (g_proxy_context.running && g_proxy_active && g_client_socket >= 0) {
            // Print statistics periodically
            ESP_LOGI(TAG, "Stats - USB: RX %d, TX %d | TCP: RX %d, TX %d", 
                     g_proxy_context.usb_bytes_received, g_proxy_context.usb_bytes_sent,
                     g_proxy_context.tcp_bytes_received, g_proxy_context.tcp_bytes_sent);
            
            vTaskDelay(pdMS_TO_TICKS(5000));  // Stats every 5 seconds
            
            // Check if connection is still alive
            char test_buf;
            int ret = recv(g_client_socket, &test_buf, 1, MSG_PEEK | MSG_DONTWAIT);
            if (ret == 0) {
                ESP_LOGI(TAG, "Client disconnected");
                break;
            }
        }
        
        // Cleanup this connection
        g_proxy_context.running = false;
        
        if (g_usb_task_handle) {
            vTaskDelete(g_usb_task_handle);
            g_usb_task_handle = NULL;
        }
        
        if (g_tcp_task_handle) {
            vTaskDelete(g_tcp_task_handle);
            g_tcp_task_handle = NULL;
        }
        
        proxy_cleanup_connection();
        
        if (g_server_socket >= 0) {
            close(g_server_socket);
            g_server_socket = -1;
        }
        
        // Reset stats for next connection
        memset(&g_proxy_context, 0, sizeof(proxy_context_t));
        g_proxy_context.running = true;
        
        ESP_LOGI(TAG, "Connection ended, ready for new client");
    }
    
    ESP_LOGI(TAG, "Main proxy task stopped");
    vTaskDelete(NULL);
}

status_t proxy_start(void) {
    if (g_proxy_active) {
        ESP_LOGW(TAG, "Proxy already active");
        return STATUS_OK;
    }
    
    if (xSemaphoreTake(g_proxy_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        ESP_LOGE(TAG, "Failed to take proxy mutex");
        return STATUS_ERROR_CONNECTION;
    }
    
    ESP_LOGI(TAG, "Starting proxy on port %d", PROXY_TCP_PORT);
    
    // Create main proxy task
    BaseType_t ret = xTaskCreate(
        proxy_task,
        "proxy_task",
        PROXY_TASK_STACK_SIZE,
        NULL,
        PROXY_TASK_PRIORITY,
        &g_proxy_task_handle
    );
    
    if (ret != pdPASS) {
        ESP_LOGE(TAG, "Failed to create proxy task");
        xSemaphoreGive(g_proxy_mutex);
        return STATUS_ERROR_MEMORY;
    }
    
    g_proxy_active = true;
    xSemaphoreGive(g_proxy_mutex);
    
    ESP_LOGI(TAG, "Proxy started successfully");
    return STATUS_OK;
}

status_t proxy_stop(void) {
    if (!g_proxy_active) {
        return STATUS_OK;
    }
    
    if (xSemaphoreTake(g_proxy_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        ESP_LOGE(TAG, "Failed to take proxy mutex");
        return STATUS_ERROR_CONNECTION;
    }
    
    ESP_LOGI(TAG, "Stopping proxy");
    
    g_proxy_active = false;
    g_proxy_context.running = false;
    
    // Wait for tasks to finish
    if (g_proxy_task_handle) {
        vTaskDelay(pdMS_TO_TICKS(100));
        g_proxy_task_handle = NULL;
    }
    
    if (g_usb_task_handle) {
        vTaskDelay(pdMS_TO_TICKS(100));
        g_usb_task_handle = NULL;
    }
    
    if (g_tcp_task_handle) {
        vTaskDelay(pdMS_TO_TICKS(100));
        g_tcp_task_handle = NULL;
    }
    
    // Cleanup connections
    proxy_cleanup_connection();
    
    if (g_server_socket >= 0) {
        close(g_server_socket);
        g_server_socket = -1;
    }
    
    xSemaphoreGive(g_proxy_mutex);
    
    ESP_LOGI(TAG, "Proxy stopped");
    return STATUS_OK;
}

status_t proxy_deinit(void) {
    ESP_LOGI(TAG, "Deinitializing proxy handler");
    
    if (g_proxy_active) {
        proxy_stop();
    }
    
    if (g_usb_to_tcp_queue) {
        vQueueDelete(g_usb_to_tcp_queue);
        g_usb_to_tcp_queue = NULL;
    }
    
    if (g_tcp_to_usb_queue) {
        vQueueDelete(g_tcp_to_usb_queue);
        g_tcp_to_usb_queue = NULL;
    }
    
    if (g_proxy_mutex) {
        vSemaphoreDelete(g_proxy_mutex);
        g_proxy_mutex = NULL;
    }
    
    ESP_LOGI(TAG, "Proxy handler deinitialized");
    return STATUS_OK;
}

bool proxy_is_active(void) {
    return g_proxy_active;
}

int proxy_get_tcp_port(void) {
    return PROXY_TCP_PORT;
}

status_t proxy_send_to_usb(const uint8_t *data, size_t length) {
    if (!g_proxy_active || data == NULL) {
        return STATUS_ERROR_CONNECTION;
    }
    
    ESP_LOGD(TAG, "Sending %d bytes to USB", length);
    
    size_t transferred;
    esp_err_t ret = usb_bulk_transfer(USB_EP1_IN_ADDR, (uint8_t*)data, length, &transferred);
    return (ret == ESP_OK) ? STATUS_OK : STATUS_ERROR_CONNECTION;
}

status_t proxy_send_to_tcp(const uint8_t *data, size_t length) {
    if (!g_proxy_active || data == NULL) {
        return STATUS_ERROR_CONNECTION;
    }
    
    ESP_LOGD(TAG, "Sending %d bytes to TCP", length);
    
    if (g_client_socket >= 0) {
        int sent = send(g_client_socket, data, length, MSG_NOSIGNAL);
        return (sent == length) ? STATUS_OK : STATUS_ERROR_CONNECTION;
    }
    
    return STATUS_ERROR_CONNECTION;
}