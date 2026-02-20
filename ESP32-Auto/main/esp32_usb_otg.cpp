#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "soc/usb_periph.h"
#include "hal/usb_hal.h"
#include "hal/gpio_hal.h"
#include "esp32_usb_otg.h"

static const char *TAG = "ESP32_USB_OTG";

// USB OTG peripheral instance
static usb_otg_dev_regs_t *g_usb_regs = NULL;
static bool g_usb_initialized = false;
static bool g_device_configured = false;
static uint8_t g_device_address = 0;
static bool g_is_connected = false;

// Interrupt callback function
static void (*g_usb_callback)(uint8_t event, void *data) = NULL;

// Internal functions
static void usb_otg_isr_handler(void *arg);
static void handle_reset_interrupt(void);
static void handle_enum_done_interrupt(void);
static void handle_rx_status_interrupt(void);
static void handle_endpoint_interrupt(uint8_t ep_num, bool is_in);

esp_err_t esp32_usb_otg_init(void) {
    ESP_LOGI(TAG, "Initializing ESP32-S3 USB OTG in device mode");
    
    // Enable USB peripheral clock
    periph_module_enable(PERIPH_USB_MODULE);
    
    // Map USB OTG registers
    g_usb_regs = (usb_otg_dev_regs_t*)USB_OTG_BASE;
    if (g_usb_regs == NULL) {
        ESP_LOGE(TAG, "Failed to map USB OTG registers");
        return ESP_ERR_INVALID_STATE;
    }
    
    // Reset USB OTG core
    esp_err_t ret = esp32_usb_otg_soft_reset();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to reset USB OTG core");
        return ret;
    }
    
    // Configure for device mode
    g_usb_regs->core.gusbcfg &= ~GUSBCFG_FHMOD;  // Clear host mode
    g_usb_regs->core.gusbcfg |= GUSBCFG_FDMOD;   // Set device mode
    
    // Configure core settings
    g_usb_regs->core.gahbcfg = GAHBCFG_GINT | GAHBCFG_TXFELVL | GAHBCFG_HBSTLEN_16;
    
    // Set device speed to Full Speed (12 Mbps)
    g_usb_regs->core.dcfg |= DCFG_DSPD_FS;
    
    // Unmask interrupts
    g_usb_regs->core.gintmsk = GINTSTS_USBRST | GINTSTS_ENUMDNE | GINTSTS_RXFLVL | 
                                 GINTSTS_IEPINT | GINTSTS_OEPINT | GINTSTS_USBSUSP |
                                 GINTSTS_USBRST | GINTSTS_ENUMDNE;
    
    // Enable USB interrupt
    // TODO: Register interrupt handler with ESP32 interrupt controller
    
    g_usb_initialized = true;
    g_device_configured = false;
    g_device_address = 0;
    g_is_connected = false;
    
    ESP_LOGI(TAG, "ESP32-S3 USB OTG initialized successfully");
    return ESP_OK;
}

esp_err_t esp32_usb_otg_deinit(void) {
    if (!g_usb_initialized) {
        return ESP_OK;
    }
    
    ESP_LOGI(TAG, "Deinitializing ESP32-S3 USB OTG");
    
    // Soft reset
    esp32_usb_otg_soft_reset();
    
    // Disable peripheral
    periph_module_disable(PERIPH_USB_MODULE);
    
    g_usb_initialized = false;
    g_device_configured = false;
    g_is_connected = false;
    
    ESP_LOGI(TAG, "ESP32-S3 USB OTG deinitialized");
    return ESP_OK;
}

esp_err_t esp32_usb_otg_soft_reset(void) {
    if (g_usb_regs == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    
    ESP_LOGD(TAG, "Performing USB OTG soft reset");
    
    // Core soft reset
    g_usb_regs->core.grstctl |= GRSTCTL_CSFTRST;
    
    // Wait for reset to complete
    uint32_t timeout = 1000;
    while ((g_usb_regs->core.grstctl & GRSTCTL_CSFTRST) && timeout--) {
        esp_rom_delay_us(1);
    }
    
    if (timeout == 0) {
        ESP_LOGE(TAG, "USB OTG soft reset timeout");
        return ESP_ERR_TIMEOUT;
    }
    
    // Reset TX FIFO
    g_usb_regs->core.grstctl |= GRSTCTL_TXFFLSH;
    esp_rom_delay_us(1);
    g_usb_regs->core.grstctl &= ~GRSTCTL_TXFFLSH;
    
    // Reset RX FIFO
    g_usb_regs->core.grstctl |= GRSTCTL_RXFFLSH;
    esp_rom_delay_us(1);
    g_usb_regs->core.grstctl &= ~GRSTCTL_RXFFLSH;
    
    return ESP_OK;
}

esp_err_t esp32_usb_otg_set_device_mode(void) {
    if (g_usb_regs == NULL || !g_usb_initialized) {
        return ESP_ERR_INVALID_STATE;
    }
    
    ESP_LOGD(TAG, "Setting USB OTG to device mode");
    
    // Configure as device
    g_usb_regs->core.gusbcfg &= ~GUSBCFG_FHMOD;  // Clear host mode
    g_usb_regs->core.gusbcfg |= GUSBCFG_FDMOD;   // Set device mode
    
    return ESP_OK;
}

esp_err_t esp32_usb_otg_set_address(uint8_t addr) {
    if (g_usb_regs == NULL || !g_usb_initialized) {
        return ESP_ERR_INVALID_STATE;
    }
    
    ESP_LOGI(TAG, "Setting USB device address: %d", addr);
    
    // Set device address in DCFG register
    uint32_t dcfg = g_usb_regs->core.dcfg;
    dcfg &= ~DCFG_DEVADDR_MASK;
    dcfg |= ((uint32_t)addr << DCFG_DEVADDR_SHIFT) & DCFG_DEVADDR_MASK;
    g_usb_regs->core.dcfg = dcfg;
    
    g_device_address = addr;
    return ESP_OK;
}

esp_err_t esp32_usb_otg_configure_endpoint(uint8_t ep_num, bool is_in, uint16_t max_packet, uint8_t ep_type) {
    if (g_usb_regs == NULL || !g_usb_initialized) {
        return ESP_ERR_INVALID_STATE;
    }
    
    if (ep_num > 15) {
        return ESP_ERR_INVALID_ARG;
    }
    
    ESP_LOGI(TAG, "Configuring EP %d (IN: %d) - Max Packet: %d, Type: %d", 
             ep_num, is_in, max_packet, ep_type);
    
    if (is_in) {
        // Configure IN endpoint
        usb_otg_in_ep_regs_t *ep = &g_usb_regs->in_ep[ep_num];
        
        uint32_t depctl = 0;
        depctl |= DEPCTL_MPS(max_packet & 0x7FF);
        depctl |= ((uint32_t)ep_type << DEPCTL_EPTYPE_SHIFT) & DEPCTL_EPTYPE_MASK;
        depctl |= DEPCTL_USBACTEP;
        
        // Clear stall and enable
        depctl &= ~DEPCTL_STALL;
        
        // For non-control endpoints, set the endpoint type
        if (ep_num != 0) {
            ep->diepctl = depctl;
        } else {
            // EP0 uses different register
            g_usb_regs->core.in_ep[0].diepctl = depctl;
        }
    } else {
        // Configure OUT endpoint
        usb_otg_out_ep_regs_t *ep = &g_usb_regs->out_ep[ep_num];
        
        uint32_t depctl = 0;
        depctl |= DEPCTL_MPS(max_packet & 0x7FF);
        depctl |= ((uint32_t)ep_type << DEPCTL_EPTYPE_SHIFT) & DEPCTL_EPTYPE_MASK;
        depctl |= DEPCTL_USBACTEP;
        
        // Clear stall
        depctl &= ~DEPCTL_STALL;
        
        if (ep_num != 0) {
            ep->doepctl = depctl;
        } else {
            g_usb_regs->core.out_ep[0].doepctl = depctl;
        }
    }
    
    return ESP_OK;
}

esp_err_t esp32_usb_otg_enable_endpoint(uint8_t ep_num, bool is_in) {
    if (g_usb_regs == NULL || !g_usb_initialized) {
        return ESP_ERR_INVALID_STATE;
    }
    
    ESP_LOGD(TAG, "Enabling EP %d (IN: %d)", ep_num, is_in);
    
    if (is_in) {
        // Enable IN endpoint
        usb_otg_in_ep_regs_t *ep = &g_usb_regs->in_ep[ep_num];
        ep->diepctl |= DEPCTL_EPENA;
        
        // Unmask endpoint interrupt
        g_usb_regs->core.diepempmsk |= (1 << ep_num);
        g_usb_regs->core.diepmsk |= (1 << ep_num);
    } else {
        // Enable OUT endpoint
        usb_otg_out_ep_regs_t *ep = &g_usb_regs->out_ep[ep_num];
        ep->doepctl |= DEPCTL_EPENA;
        
        // Unmask endpoint interrupt
        g_usb_regs->core.doepmsk |= (1 << ep_num);
    }
    
    return ESP_OK;
}

esp_err_t esp32_usb_otg_disable_endpoint(uint8_t ep_num, bool is_in) {
    if (g_usb_regs == NULL || !g_usb_initialized) {
        return ESP_ERR_INVALID_STATE;
    }
    
    ESP_LOGD(TAG, "Disabling EP %d (IN: %d)", ep_num, is_in);
    
    if (is_in) {
        // Disable IN endpoint
        usb_otg_in_ep_regs_t *ep = &g_usb_regs->in_ep[ep_num];
        ep->diepctl &= ~DEPCTL_EPENA;
        
        // Mask endpoint interrupt
        g_usb_regs->core.diepempmsk &= ~(1 << ep_num);
        g_usb_regs->core.diepmsk &= ~(1 << ep_num);
    } else {
        // Disable OUT endpoint
        usb_otg_out_ep_regs_t *ep = &g_usb_regs->out_ep[ep_num];
        ep->doepctl &= ~DEPCTL_EPENA;
        
        // Mask endpoint interrupt
        g_usb_regs->core.doepmsk &= ~(1 << ep_num);
    }
    
    return ESP_OK;
}

esp_err_t esp32_usb_otg_write_endpoint(uint8_t ep_num, uint8_t *data, uint16_t length, uint16_t *transferred) {
    if (g_usb_regs == NULL || !g_usb_initialized || data == NULL || transferred == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    
    if (ep_num > 15) {
        return ESP_ERR_INVALID_ARG;
    }
    
    ESP_LOGD(TAG, "Writing %d bytes to EP %d (IN)", length, ep_num);
    
    *transferred = 0;
    uint16_t remaining = length;
    uint8_t *src = data;
    
    // Configure endpoint for IN transfer
    usb_otg_in_ep_regs_t *ep = &g_usb_regs->in_ep[ep_num];
    
    // Wait for endpoint to be ready
    uint32_t timeout = 1000;
    while (!(ep->dtxfsts & (1 << 0)) && timeout--) {
        esp_rom_delay_us(1);
    }
    
    if (timeout == 0) {
        ESP_LOGW(TAG, "EP %d FIFO not ready for write", ep_num);
        return ESP_ERR_TIMEOUT;
    }
    
    // Write data to FIFO
    uint16_t packet_size = 64;  // Full Speed max packet size
    
    while (remaining > 0 && timeout--) {
        uint16_t chunk_size = (remaining > packet_size) ? packet_size : remaining;
        
        // Write data to FIFO (32-bit aligned)
        for (uint16_t i = 0; i < chunk_size; i += 4) {
            uint32_t word = 0;
            for (int j = 0; j < 4 && (i + j) < chunk_size; j++) {
                if (i + j < chunk_size) {
                    word |= ((uint32_t)src[i + j]) << (j * 8);
                }
            }
            // Write to FIFO
            g_usb_regs->core.in_ep[ep_num].diepemp = word;
        }
        
        *transferred += chunk_size;
        remaining -= chunk_size;
        src += chunk_size;
    }
    
    if (timeout == 0) {
        ESP_LOGW(TAG, "Timeout writing to EP %d FIFO", ep_num);
        return ESP_ERR_TIMEOUT;
    }
    
    ESP_LOGD(TAG, "Successfully wrote %d bytes to EP %d", *transferred, ep_num);
    return ESP_OK;
}

esp_err_t esp32_usb_otg_read_endpoint(uint8_t ep_num, uint8_t *data, uint16_t length, uint16_t *received) {
    if (g_usb_regs == NULL || !g_usb_initialized || data == NULL || received == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    
    if (ep_num > 15) {
        return ESP_ERR_INVALID_ARG;
    }
    
    ESP_LOGD(TAG, "Reading up to %d bytes from EP %d (OUT)", length, ep_num);
    
    *received = 0;
    uint16_t available_length = length;
    uint8_t *dest = data;
    
    // Get OUT endpoint status
    usb_otg_out_ep_regs_t *ep = &g_usb_regs->out_ep[ep_num];
    
    // Check if data is available
    uint32_t grxstsr = g_usb_regs->core.grxstsr;
    uint8_t available_ep = (grxstsr & 0x7F);
    uint16_t available_bytes = ((grxstsr >> 16) & 0x7FF);
    
    if (available_ep != ep_num || available_bytes == 0) {
        *received = 0;
        return ESP_OK;  // No data available
    }
    
    uint16_t bytes_to_read = (available_bytes < available_length) ? available_bytes : available_length;
    bytes_to_read = (bytes_to_read < length) ? bytes_to_read : length;
    
    // Read from FIFO (32-bit aligned)
    for (uint16_t i = 0; i < bytes_to_read; i += 4) {
        uint32_t word = g_usb_regs->core.out_ep[ep_num].doepfifo;
        
        for (int j = 0; j < 4 && (i + j) < bytes_to_read; j++) {
            dest[i + j] = (word >> (j * 8)) & 0xFF;
        }
    }
    
    *received = bytes_to_read;
    
    // Pop the FIFO entry
    g_usb_regs->core.grxstsr = grxstsr;
    
    ESP_LOGD(TAG, "Successfully read %d bytes from EP %d", *received, ep_num);
    return ESP_OK;
}

bool esp32_usb_otg_is_connected(void) {
    if (g_usb_regs == NULL || !g_usb_initialized) {
        return false;
    }
    
    // Check VBUS and connection status
    uint32_t dsts = g_usb_regs->core.dsts;
    g_is_connected = (dsts & DSTS_ENUMSPD_MASK) != DSTS_ENUMSPD_LS;
    
    return g_is_connected;
}

void esp32_usb_otg_print_status(void) {
    if (g_usb_regs == NULL || !g_usb_initialized) {
        ESP_LOGI(TAG, "USB OTG not initialized");
        return;
    }
    
    uint32_t gotgctl = g_usb_regs->core.gotgctl;
    uint32_t gusbcfg = g_usb_regs->core.gusbcfg;
    uint32_t dcfg = g_usb_regs->core.dcfg;
    uint32_t dsts = g_usb_regs->core.dsts;
    uint32_t dctl = g_usb_regs->core.dctl;
    uint32_t gintsts = g_usb_regs->core.gintsts;
    uint32_t daint = g_usb_regs->core.daint;
    
    ESP_LOGI(TAG, "=== ESP32 USB OTG Status ===");
    ESP_LOGI(TAG, "Mode: %s", (gusbcfg & GUSBCFG_FDMOD) ? "Device" : "Host");
    ESP_LOGI(TAG, "Speed: %s", (dcfg & DCFG_DSPD_FS) ? "Full Speed" : "High Speed");
    ESP_LOGI(TAG, "Device Address: %d", (dcfg >> 4) & 0x7F);
    ESP_LOGI(TAG, "Connected: %s", g_is_connected ? "Yes" : "No");
    ESP_LOGI(TAG, "Enumerated: %s", ((dsts >> 1) & 0x3) ? "Yes" : "No");
    ESP_LOGI(TAG, "Core Interrupts: 0x%08lX", gintsts);
    ESP_LOGI(TAG, "Device Interrupts: 0x%08lX", daint);
    ESP_LOGI(TAG, "Device Control: 0x%08lX", dctl);
    ESP_LOGI(TAG, "Device Status: 0x%08lX", dsts);
    ESP_LOGI(TAG, "OTG Control: 0x%08lX", gotgctl);
    ESP_LOGI(TAG, "USB Config: 0x%08lX", gusbcfg);
}

// Interrupt handlers (simplified)
static void usb_otg_isr_handler(void *arg) {
    if (g_usb_regs == NULL) {
        return;
    }
    
    uint32_t gintsts = g_usb_regs->core.gintsts;
    uint32_t gintmsk = g_usb_regs->core.gintmsk;
    uint32_t active_ints = gintsts & gintmsk;
    
    if (active_ints & GINTSTS_USBRST) {
        ESP_LOGI(TAG, "USB Reset detected");
        handle_reset_interrupt();
    }
    
    if (active_ints & GINTSTS_ENUMDNE) {
        ESP_LOGI(TAG, "Enumeration done");
        handle_enum_done_interrupt();
    }
    
    if (active_ints & GINTSTS_RXFLVL) {
        ESP_LOGD(TAG, "RX FIFO level interrupt");
        handle_rx_status_interrupt();
    }
    
    if (active_ints & GINTSTS_IEPINT) {
        ESP_LOGD(TAG, "IN endpoint interrupt");
        handle_endpoint_interrupt(0, true);  // Simplified
    }
    
    if (active_ints & GINTSTS_OEPINT) {
        ESP_LOGD(TAG, "OUT endpoint interrupt");
        handle_endpoint_interrupt(0, false);  // Simplified
    }
    
    // Clear interrupts
    g_usb_regs->core.gintsts = active_ints;
}

static void handle_reset_interrupt(void) {
    ESP_LOGI(TAG, "Handling USB reset");
    
    // Reset device address
    esp32_usb_otg_set_address(0);
    
    // Re-initialize endpoints
    for (int i = 0; i < 16; i++) {
        esp32_usb_otg_disable_endpoint(i, true);
        esp32_usb_otg_disable_endpoint(i, false);
    }
    
    g_device_configured = false;
    g_is_connected = false;
}

static void handle_enum_done_interrupt(void) {
    ESP_LOGI(TAG, "Handling enumeration complete");
    
    // Device should now be configured
    g_device_configured = true;
    g_is_connected = true;
    
    // Enable data endpoints
    esp32_usb_otg_configure_endpoint(1, true, 64, DEPCTL_EPTYPE_BULK);
    esp32_usb_otg_configure_endpoint(1, false, 64, DEPCTL_EPTYPE_BULK);
    esp32_usb_otg_enable_endpoint(1, true);
    esp32_usb_otg_enable_endpoint(1, false);
}

static void handle_rx_status_interrupt(void) {
    ESP_LOGD(TAG, "Handling RX status");
    // Handle RX FIFO status
    uint32_t grxstsr = g_usb_regs->core.grxstsr;
    
    // Read and clear status
    g_usb_regs->core.grxstsr = grxstsr;
}

static void handle_endpoint_interrupt(uint8_t ep_num, bool is_in) {
    ESP_LOGD(TAG, "Handling endpoint interrupt: EP %d IN:%d", ep_num, is_in);
    
    if (is_in) {
        uint32_t diepint = g_usb_regs->core.diepint;
        if (diepint & (1 << ep_num)) {
            // Clear interrupt
            g_usb_regs->core.diepint = (1 << ep_num);
            
            uint32_t dtxfsts = g_usb_regs->core.in_ep[ep_num].dtxfsts;
            if (dtxfsts & (1 << 6)) {
                ESP_LOGD(TAG, "EP %d TX FIFO empty", ep_num);
            }
        }
    } else {
        uint32_t doepint = g_usb_regs->core.doepint;
        if (doepint & (1 << ep_num)) {
            // Clear interrupt
            g_usb_regs->core.doepint = (1 << ep_num);
            
            uint32_t doeptsiz = g_usb_regs->core.out_ep[ep_num].doeptsiz;
            if (doeptsiz & (1 << 19)) {
                ESP_LOGD(TAG, "EP %d Transfer complete", ep_num);
            }
        }
    }
}