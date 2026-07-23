class_name TelemetryClient
extends Node

const ALLOWED_EVENTS := [
	"session_started", "scene_entered", "preparation_selected", "rewire_committed",
	"trace_triggered", "memory_collected", "memory_corrupted", "alert_tier_changed",
	"ending_selected", "session_completed", "performance_sample", "fatal_error",
]

var consent := false
var endpoint := ""
var session_id := ""
var queued_events: Array[Dictionary] = []
var request_count := 0
var last_error := ""

func configure(url: String) -> void:
	endpoint = url

func set_consent(value: bool) -> void:
	consent = value
	if not consent:
		queued_events.clear()

func record(event_name: String, payload := {}) -> bool:
	if not consent or event_name not in ALLOWED_EVENTS or not payload is Dictionary:
		return false
	if session_id.is_empty():
		session_id = "%08x%08x" % [randi(), Time.get_ticks_msec()]
	queued_events.append({
		"name": event_name,
		"timestamp": Time.get_datetime_string_from_system(true),
		"payload": _whitelist_payload(payload),
	})
	return true

func flush() -> bool:
	if not consent or queued_events.is_empty() or endpoint.is_empty():
		return false
	var request := HTTPRequest.new()
	add_child(request)
	request.request_completed.connect(_on_request_completed.bind(request))
	var body := JSON.stringify({
		"schema_version": 1,
		"build_version": "phase4",
		"session_id": session_id,
		"platform": OS.get_name(),
		"renderer": RenderingServer.get_video_adapter_name(),
		"events": queued_events.duplicate(true),
	})
	var error := request.request(endpoint, ["Content-Type: application/json"], HTTPClient.METHOD_POST, body)
	if error != OK:
		last_error = error_string(error)
		request.queue_free()
		return false
	request_count += 1
	queued_events.clear()
	return true

func _whitelist_payload(payload: Dictionary) -> Dictionary:
	var allowed := ["scene", "route", "ending", "tier", "memory_id", "fps", "frame_ms", "reason"]
	var clean := {}
	for key in payload:
		if str(key) in allowed and payload[key] is String or payload[key] is int or payload[key] is float or payload[key] is bool:
			clean[str(key)] = payload[key]
	return clean

func _on_request_completed(_result: int, response_code: int, _headers: PackedStringArray, _body: PackedByteArray, request: HTTPRequest) -> void:
	if response_code < 200 or response_code >= 300:
		last_error = "Telemetry unavailable (%d). Gameplay is unaffected." % response_code
	request.queue_free()
