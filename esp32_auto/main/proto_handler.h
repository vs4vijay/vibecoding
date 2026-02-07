#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

// Forward declarations for protobuf types
typedef struct WifiStartRequest WifiStartRequest;
typedef struct WifiInfoResponse WifiInfoResponse;
typedef struct DeviceInfo DeviceInfo;
typedef struct AndroidAutoMessage AndroidAutoMessage;

// Protocol buffer functions
status_t proto_init(void);
status_t proto_deinit(void);

// WiFi Start Request
WifiStartRequest* proto_create_wifi_start_request(const char *ip_address, int32_t port);
void proto_destroy_wifi_start_request(WifiStartRequest *request);
status_t proto_serialize_wifi_start_request(const WifiStartRequest *request, uint8_t **buffer, size_t *size);
WifiStartRequest* proto_deserialize_wifi_start_request(const uint8_t *buffer, size_t size);

// WiFi Info Response
WifiInfoResponse* proto_create_wifi_info_response(const char *ssid, const char *key, const char *bssid, int security_mode, int access_point_type);
void proto_destroy_wifi_info_response(WifiInfoResponse *response);
status_t proto_serialize_wifi_info_response(const WifiInfoResponse *response, uint8_t **buffer, size_t *size);
WifiInfoResponse* proto_deserialize_wifi_info_response(const uint8_t *buffer, size_t size);

// Device Info
DeviceInfo* proto_create_device_info(const char *manufacturer, const char *model, const char *description, const char *version, const char *serial);
void proto_destroy_device_info(DeviceInfo *device_info);
status_t proto_serialize_device_info(const DeviceInfo *device_info, uint8_t **buffer, size_t *size);
DeviceInfo* proto_deserialize_device_info(const uint8_t *buffer, size_t size);

// Android Auto Message wrapper
AndroidAutoMessage* proto_create_message(int message_type);
void proto_destroy_message(AndroidAutoMessage *message);
status_t proto_serialize_message(const AndroidAutoMessage *message, uint8_t **buffer, size_t *size);
AndroidAutoMessage* proto_deserialize_message(const uint8_t *buffer, size_t size);

// Message field accessors
status_t proto_set_wifi_start_request(AndroidAutoMessage *message, const WifiStartRequest *request);
status_t proto_set_wifi_info_response(AndroidAutoMessage *message, const WifiInfoResponse *response);
status_t proto_set_device_info(AndroidAutoMessage *message, const DeviceInfo *device_info);
status_t proto_set_connection_status(AndroidAutoMessage *message, int connection_status);

status_t proto_get_wifi_start_request(const AndroidAutoMessage *message, WifiStartRequest **request);
status_t proto_get_wifi_info_response(const AndroidAutoMessage *message, WifiInfoResponse **response);
status_t proto_get_device_info(const AndroidAutoMessage *message, DeviceInfo **device_info);
status_t proto_get_connection_status(const AndroidAutoMessage *message, int *connection_status);
status_t proto_get_message_type(const AndroidAutoMessage *message, int *type);

// Utility functions
bool proto_validate_message(const uint8_t *buffer, size_t size);
uint64_t proto_get_timestamp(void);
void proto_set_timestamp(AndroidAutoMessage *message, uint64_t timestamp);

// Constants
#define PROTO_MESSAGE_TYPE_UNKNOWN 0
#define PROTO_MESSAGE_TYPE_WIFI_START_REQUEST 1
#define PROTO_MESSAGE_TYPE_WIFI_INFO_RESPONSE 2
#define PROTO_MESSAGE_TYPE_DEVICE_INFO 3
#define PROTO_MESSAGE_TYPE_CONNECTION_STATUS 4
#define PROTO_MESSAGE_TYPE_HEARTBEAT 5

#define PROTO_SECURITY_MODE_UNKNOWN 0
#define PROTO_SECURITY_MODE_OPEN 1
#define PROTO_SECURITY_MODE_WEP_64 2
#define PROTO_SECURITY_MODE_WEP_128 3
#define PROTO_SECURITY_MODE_WPA_PERSONAL 4
#define PROTO_SECURITY_MODE_WPA2_PERSONAL 8
#define PROTO_SECURITY_MODE_WPA_WPA2_PERSONAL 12
#define PROTO_SECURITY_MODE_WPA_ENTERPRISE 20
#define PROTO_SECURITY_MODE_WPA2_ENTERPRISE 24
#define PROTO_SECURITY_MODE_WPA_WPA2_ENTERPRISE 28

#define PROTO_ACCESS_POINT_TYPE_STATIC 0
#define PROTO_ACCESS_POINT_TYPE_DYNAMIC 1

#define PROTO_CONNECTION_STATUS_DISCONNECTED 0
#define PROTO_CONNECTION_STATUS_CONNECTING 1
#define PROTO_CONNECTION_STATUS_CONNECTED 2
#define PROTO_CONNECTION_STATUS_ERROR 3