cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(esp32_wireless_dongle)

idf_component_register(
    SRCS
        "main.cpp"
        "usb_gadget.cpp"
        "esp32_usb_otg.cpp"
        "aoa_protocol.cpp"
        "wifi_hotspot.cpp"
        "bluetooth_manager.cpp"
        "proxy_handler.cpp"
        "proto_handler.cpp"
    INCLUDE_DIRS
        "."
    REQUIRES
        esp_wifi
        esp_netif
        bt
        nvs_flash
        freertos
        usb
        esp_timer
        lwip
)