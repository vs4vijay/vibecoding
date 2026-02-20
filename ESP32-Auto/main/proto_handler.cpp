#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include <string.h>
#include <stdlib.h>
#include "proto_handler.h"
#include "common.h"

static const char *TAG = "PROTO_HANDLER";

// Simplified protobuf implementation for ESP32
// In a real implementation, you would use nanopb or protobuf-c

// Message structure definitions
typedef struct {
    char ip_address[64];
    int32_t port;
} WifiStartRequestImpl;

typedef struct {
    char ssid[64];
    char key[64];
    char bssid[18];
    int32_t security_mode;
    int32_t access_point_type;
} WifiInfoResponseImpl;

typedef struct {
    char manufacturer[256];
    char model[256];
    char description[256];
    char version[64];
    char serial[64];
} DeviceInfoImpl;

typedef struct {
    int32_t type;
    WifiStartRequestImpl *wifi_start_request;
    WifiInfoResponseImpl *wifi_info_response;
    DeviceInfoImpl *device_info;
    int32_t connection_status;
    uint64_t timestamp;
} AndroidAutoMessageImpl;

// Forward declarations for implementation
typedef WifiStartRequestImpl WifiStartRequest;
typedef WifiInfoResponseImpl WifiInfoResponse;
typedef DeviceInfoImpl DeviceInfo;
typedef AndroidAutoMessageImpl AndroidAutoMessage;

static bool g_proto_initialized = false;

status_t proto_init(void) {
    ESP_LOGI(TAG, "Initializing Protocol Buffers handler");
    
    g_proto_initialized = true;
    ESP_LOGI(TAG, "Protocol Buffers handler initialized");
    return STATUS_OK;
}

status_t proto_deinit(void) {
    ESP_LOGI(TAG, "Deinitializing Protocol Buffers handler");
    
    g_proto_initialized = false;
    ESP_LOGI(TAG, "Protocol Buffers handler deinitialized");
    return STATUS_OK;
}

WifiStartRequest* proto_create_wifi_start_request(const char *ip_address, int32_t port) {
    if (ip_address == NULL) {
        return NULL;
    }
    
    WifiStartRequest *request = (WifiStartRequest*)malloc(sizeof(WifiStartRequest));
    if (request == NULL) {
        return NULL;
    }
    
    strncpy(request->ip_address, ip_address, sizeof(request->ip_address) - 1);
    request->ip_address[sizeof(request->ip_address) - 1] = '\0';
    request->port = port;
    
    return request;
}

void proto_destroy_wifi_start_request(WifiStartRequest *request) {
    if (request != NULL) {
        free(request);
    }
}

status_t proto_serialize_wifi_start_request(const WifiStartRequest *request, uint8_t **buffer, size_t *size) {
    if (request == NULL || buffer == NULL || size == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    // Simple serialization for demonstration
    // Format: [type:4][ip_len:4][ip_data][port:4]
    *size = sizeof(int32_t) + sizeof(int32_t) + strlen(request->ip_address) + sizeof(int32_t);
    *buffer = (uint8_t*)malloc(*size);
    
    if (*buffer == NULL) {
        return STATUS_ERROR_MEMORY;
    }
    
    uint8_t *ptr = *buffer;
    
    // Message type
    *((int32_t*)ptr) = PROTO_MESSAGE_TYPE_WIFI_START_REQUEST;
    ptr += sizeof(int32_t);
    
    // IP address length and data
    *((int32_t*)ptr) = strlen(request->ip_address);
    ptr += sizeof(int32_t);
    strcpy((char*)ptr, request->ip_address);
    ptr += strlen(request->ip_address);
    
    // Port
    *((int32_t*)ptr) = request->port;
    
    return STATUS_OK;
}

WifiStartRequest* proto_deserialize_wifi_start_request(const uint8_t *buffer, size_t size) {
    if (buffer == NULL || size < sizeof(int32_t) * 3) {
        return NULL;
    }
    
    const uint8_t *ptr = buffer;
    
    // Skip message type
    ptr += sizeof(int32_t);
    
    // Read IP address
    int32_t ip_len = *((int32_t*)ptr);
    ptr += sizeof(int32_t);
    
    if (size < sizeof(int32_t) * 3 + ip_len) {
        return NULL;
    }
    
    WifiStartRequest *request = (WifiStartRequest*)malloc(sizeof(WifiStartRequest));
    if (request == NULL) {
        return NULL;
    }
    
    strncpy(request->ip_address, (char*)ptr, ip_len);
    request->ip_address[ip_len] = '\0';
    ptr += ip_len;
    
    // Read port
    request->port = *((int32_t*)ptr);
    
    return request;
}

WifiInfoResponse* proto_create_wifi_info_response(const char *ssid, const char *key, const char *bssid, int security_mode, int access_point_type) {
    if (ssid == NULL || key == NULL) {
        return NULL;
    }
    
    WifiInfoResponse *response = (WifiInfoResponse*)malloc(sizeof(WifiInfoResponse));
    if (response == NULL) {
        return NULL;
    }
    
    strncpy(response->ssid, ssid, sizeof(response->ssid) - 1);
    response->ssid[sizeof(response->ssid) - 1] = '\0';
    
    strncpy(response->key, key, sizeof(response->key) - 1);
    response->key[sizeof(response->key) - 1] = '\0';
    
    if (bssid != NULL) {
        strncpy(response->bssid, bssid, sizeof(response->bssid) - 1);
        response->bssid[sizeof(response->bssid) - 1] = '\0';
    } else {
        strcpy(response->bssid, "00:00:00:00:00:00");
    }
    
    response->security_mode = security_mode;
    response->access_point_type = access_point_type;
    
    return response;
}

void proto_destroy_wifi_info_response(WifiInfoResponse *response) {
    if (response != NULL) {
        free(response);
    }
}

DeviceInfo* proto_create_device_info(const char *manufacturer, const char *model, const char *description, const char *version, const char *serial) {
    if (manufacturer == NULL || model == NULL || description == NULL) {
        return NULL;
    }
    
    DeviceInfo *device_info = (DeviceInfo*)malloc(sizeof(DeviceInfo));
    if (device_info == NULL) {
        return NULL;
    }
    
    strncpy(device_info->manufacturer, manufacturer, sizeof(device_info->manufacturer) - 1);
    device_info->manufacturer[sizeof(device_info->manufacturer) - 1] = '\0';
    
    strncpy(device_info->model, model, sizeof(device_info->model) - 1);
    device_info->model[sizeof(device_info->model) - 1] = '\0';
    
    strncpy(device_info->description, description, sizeof(device_info->description) - 1);
    device_info->description[sizeof(device_info->description) - 1] = '\0';
    
    if (version != NULL) {
        strncpy(device_info->version, version, sizeof(device_info->version) - 1);
        device_info->version[sizeof(device_info->version) - 1] = '\0';
    } else {
        strcpy(device_info->version, "1.0");
    }
    
    if (serial != NULL) {
        strncpy(device_info->serial, serial, sizeof(device_info->serial) - 1);
        device_info->serial[sizeof(device_info->serial) - 1] = '\0';
    } else {
        strcpy(device_info->serial, "ESP32AA001");
    }
    
    return device_info;
}

void proto_destroy_device_info(DeviceInfo *device_info) {
    if (device_info != NULL) {
        free(device_info);
    }
}

AndroidAutoMessage* proto_create_message(int message_type) {
    AndroidAutoMessage *message = (AndroidAutoMessage*)malloc(sizeof(AndroidAutoMessage));
    if (message == NULL) {
        return NULL;
    }
    
    memset(message, 0, sizeof(AndroidAutoMessage));
    message->type = message_type;
    message->timestamp = proto_get_timestamp();
    
    return message;
}

void proto_destroy_message(AndroidAutoMessage *message) {
    if (message == NULL) {
        return;
    }
    
    // Clean up nested messages
    if (message->wifi_start_request != NULL) {
        free(message->wifi_start_request);
        message->wifi_start_request = NULL;
    }
    
    if (message->wifi_info_response != NULL) {
        free(message->wifi_info_response);
        message->wifi_info_response = NULL;
    }
    
    if (message->device_info != NULL) {
        free(message->device_info);
        message->device_info = NULL;
    }
    
    free(message);
}

status_t proto_serialize_message(const AndroidAutoMessage *message, uint8_t **buffer, size_t *size) {
    if (message == NULL || buffer == NULL || size == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    // For now, just serialize the nested message
    switch (message->type) {
        case PROTO_MESSAGE_TYPE_WIFI_START_REQUEST:
            if (message->wifi_start_request) {
                return proto_serialize_wifi_start_request(message->wifi_start_request, buffer, size);
            }
            break;
            
        default:
            ESP_LOGW(TAG, "Unknown message type for serialization: %d", message->type);
            break;
    }
    
    return STATUS_ERROR_PROTOCOL;
}

AndroidAutoMessage* proto_deserialize_message(const uint8_t *buffer, size_t size) {
    if (buffer == NULL || size < sizeof(int32_t)) {
        return NULL;
    }
    
    int32_t message_type = *((int32_t*)buffer);
    AndroidAutoMessage *message = proto_create_message(message_type);
    if (message == NULL) {
        return NULL;
    }
    
    switch (message_type) {
        case PROTO_MESSAGE_TYPE_WIFI_START_REQUEST:
            message->wifi_start_request = proto_deserialize_wifi_start_request(buffer, size);
            if (message->wifi_start_request == NULL) {
                proto_destroy_message(message);
                return NULL;
            }
            break;
            
        default:
            ESP_LOGW(TAG, "Unknown message type for deserialization: %d", message_type);
            proto_destroy_message(message);
            return NULL;
    }
    
    return message;
}

status_t proto_get_message_type(const AndroidAutoMessage *message, int *type) {
    if (message == NULL || type == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    *type = message->type;
    return STATUS_OK;
}

uint64_t proto_get_timestamp(void) {
    return esp_timer_get_time() / 1000;  // Convert to milliseconds
}

void proto_set_timestamp(AndroidAutoMessage *message, uint64_t timestamp) {
    if (message != NULL) {
        message->timestamp = timestamp;
    }
}

bool proto_validate_message(const uint8_t *buffer, size_t size) {
    if (buffer == NULL || size < sizeof(int32_t)) {
        return false;
    }
    
    int32_t message_type = *((int32_t*)buffer);
    
    // Validate message type
    switch (message_type) {
        case PROTO_MESSAGE_TYPE_WIFI_START_REQUEST:
        case PROTO_MESSAGE_TYPE_WIFI_INFO_RESPONSE:
        case PROTO_MESSAGE_TYPE_DEVICE_INFO:
        case PROTO_MESSAGE_TYPE_CONNECTION_STATUS:
        case PROTO_MESSAGE_TYPE_HEARTBEAT:
            return true;
            
        default:
            ESP_LOGW(TAG, "Unknown message type: %d", message_type);
            return false;
    }
}

status_t proto_set_device_info(AndroidAutoMessage *message, const DeviceInfo *device_info) {
    if (message == NULL || device_info == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    // Clean up existing device info
    if (message->device_info != NULL) {
        free(message->device_info);
    }
    
    // Create copy of device info
    message->device_info = (DeviceInfo*)malloc(sizeof(DeviceInfo));
    if (message->device_info == NULL) {
        return STATUS_ERROR_MEMORY;
    }
    
    memcpy(message->device_info, device_info, sizeof(DeviceInfo));
    message->type = PROTO_MESSAGE_TYPE_DEVICE_INFO;
    
    return STATUS_OK;
}

status_t proto_get_device_info(const AndroidAutoMessage *message, DeviceInfo **device_info) {
    if (message == NULL || device_info == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    if (message->device_info == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    // Create copy for caller
    *device_info = (DeviceInfo*)malloc(sizeof(DeviceInfo));
    if (*device_info == NULL) {
        return STATUS_ERROR_MEMORY;
    }
    
    memcpy(*device_info, message->device_info, sizeof(DeviceInfo));
    
    return STATUS_OK;
}

status_t proto_set_connection_status(AndroidAutoMessage *message, int connection_status) {
    if (message == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    message->connection_status = connection_status;
    message->type = PROTO_MESSAGE_TYPE_CONNECTION_STATUS;
    
    return STATUS_OK;
}

status_t proto_get_connection_status(const AndroidAutoMessage *message, int *connection_status) {
    if (message == NULL || connection_status == NULL) {
        return STATUS_ERROR_PROTOCOL;
    }
    
    *connection_status = message->connection_status;
    return STATUS_OK;
}