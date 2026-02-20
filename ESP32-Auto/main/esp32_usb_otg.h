#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

// ESP32-S3 USB OTG Controller Base Address
#define USB_OTG_BASE           0x60018000
#define USB_OTG_FIFO_BASE        0x60020000

// USB OTG Core Registers
#define USB_OTG_GOTGCTL        (USB_OTG_BASE + 0x0000)  // OTG Control and Status
#define USB_OTG_GOTGINT        (USB_OTG_BASE + 0x0004)  // OTG Interrupt Register
#define USB_OTG_GAHBCFG        (USB_OTG_BASE + 0x0008)  // Core AHB Configuration
#define USB_OTG_GUSBCFG        (USB_OTG_BASE + 0x000C)  // Core USB Configuration
#define USB_OTG_GRSTCTL        (USB_OTG_BASE + 0x0010)  // Core Reset Register
#define USB_OTG_GINTSTS        (USB_OTG_BASE + 0x0014)  // Core Interrupt Register
#define USB_OTG_GINTMSK        (USB_OTG_BASE + 0x0018)  // Core Interrupt Mask
#define USB_OTG_GRXSTSR       (USB_OTG_BASE + 0x001C)  // Receive Status Read and Pop
#define USB_OTG_GRXFSIZ        (USB_OTG_BASE + 0x0024)  // Receive FIFO Size
#define USB_OTG_GNPTXFSIZ      (USB_OTG_BASE + 0x0028)  // Non-Periodic Tx FIFO Size
#define USB_OTG_GNPTXSTS      (USB_OTG_BASE + 0x002C)  // Non-Periodic Tx FIFO/Queue Status
#define USB_OTG_GI2CCTL       (USB_OTG_BASE + 0x0030)  // I2C Access Control
#define USB_OTG_GI2CDATA       (USB_OTG_BASE + 0x0034)  // I2C Read/Write Data
#define USB_OTG_GPVNDCTL       (USB_OTG_BASE + 0x00E0)  // PHY Vendor Control
#define USB_OTG_GPVNDSTAT      (USB_OTG_BASE + 0x00E4)  // PHY Vendor Status

// Device Mode Registers
#define USB_OTG_DCFG           (USB_OTG_BASE + 0x0800)  // Device Configuration Register
#define USB_OTG_DCTL           (USB_OTG_BASE + 0x0804)  // Device Control Register
#define USB_OTG_DSTS           (USB_OTG_BASE + 0x0808)  // Device Status Register
#define USB_OTG_DIEPMSK       (USB_OTG_BASE + 0x0810)  // Device IN EP Common Interrupt Mask
#define USB_OTG_DOEPMSK       (USB_OTG_BASE + 0x0814)  // Device OUT EP Common Interrupt Mask
#define USB_OTG_DAINT          (USB_OTG_BASE + 0x0818)  // Device All Endpoints Interrupt
#define USB_OTG_DAINTMSK       (USB_OTG_BASE + 0x081C)  // Device All Endpoints Interrupt Mask
#define USB_OTG_DVBUSDIS       (USB_OTG_BASE + 0x0828)  // Device VBUS Discharge
#define USB_OTG_DVBUSPULSE     (USB_OTG_BASE + 0x082C)  // Device VBUS Pulsing
#define USB_OTG_DTHRCTL        (USB_OTG_BASE + 0x0830)  // Device Threshold Control
#define USB_OTG_DIEPEMPMSK     (USB_OTG_BASE + 0x0834)  // Device IN EP FIFO Empty Interrupt Mask
#define USB_OTG_DEACHINT       (USB_OTG_BASE + 0x0838)  // Device Each Endpoint Interrupt
#define USB_OTG_DEACHINTMSK    (USB_OTG_BASE + 0x083C)  // Device Each Endpoint Interrupt Mask

// Device IN Endpoint Registers
#define USB_OTG_DIEPCTL0      (USB_OTG_BASE + 0x0900)  // Device IN EP 0 Control Register
#define USB_OTG_DIEPCTL(x)    (USB_OTG_BASE + 0x0900 + (0x20 * (x)))  // Device IN EP Control
#define USB_OTG_DIEPINT(x)    (USB_OTG_BASE + 0x0908 + (0x20 * (x)))  // Device IN EP Interrupt
#define USB_OTG_DIEPTSIZ(x)   (USB_OTG_BASE + 0x0910 + (0x20 * (x)))  // Device IN EP Transfer Size
#define USB_OTG_DIEPDMA(x)    (USB_OTG_BASE + 0x0914 + (0x20 * (x)))  // Device IN EP DMA Address
#define USB_OTG_DTXFSTS(x)    (USB_OTG_BASE + 0x0918 + (0x20 * (x)))  // Device IN EP Tx FIFO Status

// Device OUT Endpoint Registers
#define USB_OTG_DOEPCTL0      (USB_OTG_BASE + 0x0B00)  // Device OUT EP 0 Control Register
#define USB_OTG_DOEPCTL(x)    (USB_OTG_BASE + 0x0B00 + (0x20 * (x)))  // Device OUT EP Control
#define USB_OTG_DOEPINT(x)    (USB_OTG_BASE + 0x0B08 + (0x20 * (x)))  // Device OUT EP Interrupt
#define USB_OTG_DOEPTSIZ(x)   (USB_OTG_BASE + 0x0B10 + (0x20 * (x)))  // Device OUT EP Transfer Size
#define USB_OTG_DOEPDMA(x)    (USB_OTG_BASE + 0x0B14 + (0x20 * (x)))  // Device OUT EP DMA Address
#define USB_OTG_DOEPFIFO(x)   (USB_OTG_BASE + 0x0B20 + (0x20 * (x)))  // Device OUT EP FIFO

// Power and Clock Gating Register
#define USB_OTG_PCGCCTL        (USB_OTG_BASE + 0x0E00)  // Power and Clock Gating Control

// FIFO Registers
#define USB_OTG_DFIFO(x)       (USB_OTG_FIFO_BASE + (0x1000 * (x)))  // Data FIFO

// Bit Definitions for Common Registers
// GOTGCTL
#define GOTGCTL_BVALIDVAL        (1 << 7)
#define GOTGCTL_AVALIDVAL        (1 << 6)
#define GOTGCTL_VBVALVAL        (1 << 5)
#define GOTGCTL_OTGVER           (1 << 4)
#define GOTGCTL_REQPWRUP        (1 << 3)
#define GOTGCTL_HSTNEGSCS        (1 << 2)
#define GOTGCTL_HNPREQPWR        (1 << 1)
#define GOTGCTL_HSTSETHNPEN     (1 << 0)

// GINTSTS / GINTMSK
#define GINTSTS_WKUPINT          (1 << 31)
#define GINTSTS_SRQINT           (1 << 30)
#define GINTSTS_PTXFE            (1 << 26)
#define GINTSTS_HCINT            (1 << 25)
#define GINTSTS_HPRTINT          (1 << 24)
#define GINTSTS_DISCONNINT        (1 << 23)
#define GINTSTS_CONNINT           (1 << 22)
#define GINTSTS_CIDSCHG          (1 << 21)
#define GINTSTS_LPMINT           (1 << 20)
#define GINTSTS_OEPINT           (1 << 19)
#define GINTSTS_IEPINT           (1 << 18)
#define GINTSTS_EPMIS            (1 << 17)
#define GINTSTS_EOPF             (1 << 15)
#define GINTSTS_ISOODRP          (1 << 14)
#define GINTSTS_ENUMDNE          (1 << 13)
#define GINTSTS_USBRST           (1 << 12)
#define GINTSTS_USBSUSP          (1 << 11)
#define GINTSTS_ERLYSUSP         (1 << 10)
#define GINTSTS_GOUTNAKEFF       (1 << 9)
#define GINTSTS_GINNAKEFF        (1 << 8)
#define GINTSTS_NPTXFE           (1 << 7)
#define GINTSTS_RXFLVL           (1 << 6)
#define GINTSTS_SOF              (1 << 3)
#define GINTSTS_OTGINT           (1 << 2)
#define GINTSTS_MODMSK           (1 << 0)

// GAHBCFG
#define GAHBCFG_GINT             (1 << 0)
#define GAHBCFG_HBSTLEN_SHIFT    (1)
#define GAHBCFG_HBSTLEN_MASK     (0x3 << GAHBCFG_HBSTLEN_SHIFT)
#define GAHBCFG_DMAEN           (1 << 5)
#define GAHBCFG_TXFELVL         (1 << 7)
#define GAHBCFG_PTXFELVL        (1 << 8)

// GUSBCFG
#define GUSBCFG_TOCAL           (1 << 0)
#define GUSBCFG_PHYSEL          (1 << 6)
#define GUSBCFG_SRPCAP          (1 << 8)
#define GUSBCFG_HNPCAP          (1 << 9)
#define GUSBCFG_TRDT_SHIFT      10
#define GUSBCFG_TRDT_MASK       (0xF << GUSBCFG_TRDT_SHIFT)
#define GUSBCFG_FHMOD           (1 << 29)
#define GUSBCFG_FDMOD           (1 << 30)

// GRSTCTL
#define GRSTCTL_CSFTRST         (1 << 0)
#define GRSTCTL_HSFTRST         (1 << 1)
#define GRSTCTL_FCRST           (1 << 2)
#define GRSTCTL_RXFFLSH         (1 << 3)
#define GRSTCTL_TXFFLSH         (1 << 4)
#define GRSTCTL_TXFNUM_SHIFT     6
#define GRSTCTL_TXFNUM_MASK      (0x1F << GRSTCTL_TXFNUM_SHIFT)
#define GRSTCTL_DMAREQ          (1 << 30)

// DCFG
#define DCFG_DSPD_SHIFT         0
#define DCFG_DSPD_MASK          (0x3 << DCFG_DSPD_SHIFT)
#define DCFG_DEVADDR_SHIFT      4
#define DCFG_DEVADDR_MASK       (0x7F << DCFG_DEVADDR_SHIFT)
#define DCFG_NZLSOHSK         (1 << 2)
#define DCFG_PERFRINT          (1 << 11)

// DCTL
#define DCTL_RUNSTOP           (1 << 0)
#define DCTL_CGNPINNAK         (1 << 1)
#define DCTL_SGOUTNAK          (1 << 2)
#define DCTL_CGNAK            (1 << 7)
#define DCTL_SGNAK            (1 << 8)
#define DCTL_PWRONPRGDONE      (1 << 11)

// DSTS
#define DSTS_SUSPSTS           (1 << 0)
#define DSTS_ENUMSPD_SHIFT      1
#define DSTS_ENUMSPD_MASK       (0x3 << DSTS_ENUMSPD_SHIFT)
#define DSTS_ENUMSPD_HS        (0 << DSTS_ENUMSPD_SHIFT)
#define DSTS_ENUMSPD_FS        (1 << DSTS_ENUMSPD_SHIFT)
#define DSTS_ENUMSPD_LS        (2 << DSTS_ENUMSPD_SHIFT)

// DIEPCTL / DOEPCTL
#define DEPCTL_MPS            (1 << 0)
#define DEPCTL_USBACTEP        (1 << 15)
#define DEPCTL_NAKSTS         (1 << 17)
#define DEPCTL_EPTYPE_SHIFT   18
#define DEPCTL_EPTYPE_MASK    (0x3 << DEPCTL_EPTYPE_SHIFT)
#define DEPCTL_EPTYPE_CTRL    (0 << DEPCTL_EPTYPE_SHIFT)
#define DEPCTL_EPTYPE_ISO     (1 << DEPCTL_EPTYPE_SHIFT)
#define DEPCTL_EPTYPE_BULK    (2 << DEPCTL_EPTYPE_SHIFT)
#define DEPCTL_EPTYPE_INT     (3 << DEPCTL_EPTYPE_SHIFT)
#define DEPCTL_STALL           (1 << 21)
#define DEPCTL_EPENA          (1 << 31)

// DIEPINT / DOEPINT
#define DEPINT_XFERCOMPL      (1 << 0)
#define DEPINT_EPDISBLD       (1 << 1)
#define DEPINT_AHBERR         (1 << 2)
#define DEPINT_TIMEOUT         (1 << 3)

// Structures for ESP32-S3 USB OTG
typedef struct {
    volatile uint32_t gotgctl;
    volatile uint32_t gotgint;
    volatile uint32_t gahbcfg;
    volatile uint32_t gusbcfg;
    volatile uint32_t grstctl;
    volatile uint32_t gintsts;
    volatile uint32_t gintmsk;
    volatile uint32_t grxstsr;
    volatile uint32_t grxstsp;
    volatile uint32_t grxfsiz;
    uint32_t reserved0x10[3];
    volatile uint32_t gnptxfsiz;
    volatile uint32_t gnptxsts;
    uint32_t reserved0x2C[2];
    volatile uint32_t gi2cctl;
    volatile uint32_t gi2cdata;
    uint32_t reserved0x38[86];
    volatile uint32_t hptxfsiz;
    uint32_t reserved0x100[60];
    volatile uint32_t dcfg;
    volatile uint32_t dctl;
    volatile uint32_t dsts;
    uint32_t reserved0x80C;
    volatile uint32_t diepmsk;
    uint32_t reserved0x814;
    volatile uint32_t doepmsk;
    uint32_t reserved0x81C;
    volatile uint32_t daint;
    volatile uint32_t daintmsk;
    uint32_t reserved0x824[8];
    volatile uint32_t dvbusdis;
    uint32_t reserved0x82C;
    volatile uint32_t dvbuspulse;
    uint32_t reserved0x834;
    volatile uint32_t dthrctl;
    uint32_t reserved0x83C;
    volatile uint32_t diepempmsk;
    uint32_t reserved0x844;
    volatile uint32_t deachint;
    volatile uint32_t deachintmsk;
    uint32_t reserved0x850[50];
    volatile uint32_t pcgcctl;
    uint32_t reserved0xE04[63];
    volatile uint32_t gpvndctl;
    volatile uint32_t gpvndstat;
} usb_otg_core_regs_t;

typedef struct {
    volatile uint32_t diepctl;
    volatile uint32_t reserved0x904;
    volatile uint32_t diepint;
    volatile uint32_t reserved0x90C;
    volatile uint32_t dieptsiz;
    volatile uint32_t diepdma;
    uint32_t reserved0x918;
    volatile uint32_t dtxfsts;
} usb_otg_in_ep_regs_t;

typedef struct {
    volatile uint32_t doepctl;
    volatile uint32_t reserved0xB04;
    volatile uint32_t doepint;
    volatile uint32_t reserved0xB0C;
    volatile uint32_t doeptsiz;
    volatile uint32_t doepdma;
    volatile uint32_t doepdma2;
    volatile uint32_t doepfsts;
} usb_otg_out_ep_regs_t;

// USB OTG Device Registers (Device Mode)
typedef struct {
    usb_otg_core_regs_t core;
    usb_otg_in_ep_regs_t in_ep[16];
    usb_otg_out_ep_regs_t out_ep[16];
} usb_otg_dev_regs_t;

// Function declarations
esp_err_t esp32_usb_otg_init(void);
esp_err_t esp32_usb_otg_deinit(void);
esp_err_t esp32_usb_otg_soft_reset(void);
esp_err_t esp32_usb_otg_set_device_mode(void);
esp_err_t esp32_usb_otg_set_address(uint8_t addr);
esp_err_t esp32_usb_otg_configure_endpoint(uint8_t ep_num, bool is_in, uint16_t max_packet, uint8_t ep_type);
esp_err_t esp32_usb_otg_enable_endpoint(uint8_t ep_num, bool is_in);
esp_err_t esp32_usb_otg_disable_endpoint(uint8_t ep_num, bool is_in);
esp_err_t esp32_usb_otg_write_endpoint(uint8_t ep_num, uint8_t *data, uint16_t length, uint16_t *transferred);
esp_err_t esp32_usb_otg_read_endpoint(uint8_t ep_num, uint8_t *data, uint16_t length, uint16_t *received);
bool esp32_usb_otg_is_connected(void);
void esp32_usb_otg_print_status(void);