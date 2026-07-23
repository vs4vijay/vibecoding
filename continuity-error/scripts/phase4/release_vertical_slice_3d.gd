class_name ReleaseVerticalSlice3D
extends PresentationVerticalSlice3D

const AccessibilitySettingsScript = preload("res://scripts/phase4/accessibility_settings.gd")
const TelemetryClientScript = preload("res://scripts/phase4/telemetry_client.gd")
const SaveServiceScript = preload("res://scripts/autoload/save_service.gd")

var accessibility := AccessibilitySettingsScript.new()
var telemetry: Node
var pause_overlay: PanelContainer
var settings_overlay: PanelContainer
var consent_overlay: PanelContainer
var save_notice: Label
var touch_controls: HBoxContainer
var loading_overlay: ColorRect
var settings_open := false
var telemetry_decided := false
var save_failure_simulated := false

func _ready() -> void:
	super()
	telemetry = TelemetryClientScript.new()
	telemetry.name = "TelemetryClient"
	add_child(telemetry)
	_build_release_ui()
	get_viewport().size_changed.connect(_apply_responsive_layout)
	_apply_responsive_layout()
	call_deferred("_finish_loading")

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		toggle_pause()
		return
	if event.is_action_pressed("open_settings"):
		toggle_settings()
		return
	super(event)

func choose_telemetry(allowed: bool) -> void:
	telemetry_decided = true
	telemetry.set_consent(allowed)
	consent_overlay.visible = false
	status_message = "Anonymous telemetry enabled." if allowed else "Telemetry declined. No event requests will be sent."
	if allowed:
		telemetry.record("session_started", {"scene": "opening"})
	_refresh()

func toggle_pause() -> void:
	get_tree().paused = not get_tree().paused
	pause_overlay.visible = get_tree().paused

func toggle_settings() -> void:
	settings_open = not settings_open
	settings_overlay.visible = settings_open

func apply_accessibility(options: Dictionary) -> void:
	accessibility.load_dict(options)
	dialogue_label.add_theme_font_size_override("font_size", roundi(19.0 * accessibility.subtitle_scale))
	$HUD.scale = Vector2.ONE * accessibility.ui_scale
	$HUD/TopBar.modulate = Color.WHITE if not accessibility.high_contrast_topology else Color("fff36b")
	for player in soundscape_players:
		player.volume_db = linear_to_db(accessibility.music_level) if accessibility.music_level > 0.0 else -80.0
	if accessibility.reduced_flashing:
		var effect := hub_world.get_node_or_null("ExtractionEffect")
		if effect is GPUParticles3D:
			effect.amount = mini(effect.amount, 18)

func save_with_feedback(path := "user://continuity-error-save.json") -> bool:
	var actual_path: String = path
	if save_failure_simulated:
		actual_path = "res://build/forbidden/save.json"
	var state = heist.mission.game_state if heist != null else null
	if state == null or not SaveServiceScript.new().save_game(state, actual_path):
		save_notice.text = "SAVE FAILED — progress remains in memory. Free browser storage, then choose Retry Save."
		save_notice.visible = true
		return false
	save_notice.text = "Progress saved locally."
	save_notice.visible = true
	return true

func restart_slice() -> void:
	get_tree().paused = false
	get_tree().reload_current_scene()

func open_survey() -> String:
	return "https://example.com/continuity-error-survey"

func _build_release_ui() -> void:
	loading_overlay = ColorRect.new()
	loading_overlay.name = "LoadingOverlay"
	loading_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	loading_overlay.color = Color("050814")
	loading_overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	$HUD.add_child(loading_overlay)
	var loading := Label.new()
	loading.text = "CONTINUITY ERROR\nLOADING SECURE MEMORY HOSPICE…"
	loading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	loading.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	loading.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	loading.add_theme_font_size_override("font_size", 26)
	loading_overlay.add_child(loading)

	consent_overlay = _overlay("ConsentOverlay", "OPTIONAL ANONYMOUS TELEMETRY\n\nShare only whitelisted gameplay events and performance samples? No names, accounts, dialogue, or free-form text.\n\n[Y] ALLOW     [N] DECLINE")
	consent_overlay.visible = true
	pause_overlay = _overlay("PauseOverlay", "PAUSED\n\n[ESC] RESUME     [O] SETTINGS     RESTART AVAILABLE")
	pause_overlay.process_mode = Node.PROCESS_MODE_WHEN_PAUSED
	pause_overlay.visible = false
	settings_overlay = _overlay("SettingsOverlay", "ACCESSIBILITY & SETTINGS\n\nUI / subtitles 80–150%  •  reduced motion / flashing\nhigh-contrast topology  •  music / effects / voice levels\nall keyboard and mouse actions remappable")
	settings_overlay.process_mode = Node.PROCESS_MODE_ALWAYS
	settings_overlay.visible = false

	save_notice = Label.new()
	save_notice.name = "SaveNotice"
	save_notice.position = Vector2(24, 610)
	save_notice.size = Vector2(900, 38)
	save_notice.add_theme_color_override("font_color", Color("fff36b"))
	save_notice.visible = false
	$HUD.add_child(save_notice)

	touch_controls = HBoxContainer.new()
	touch_controls.name = "TouchSafeControls"
	touch_controls.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	touch_controls.position = Vector2(-350, -82)
	for title in ["MOVE", "INTERACT", "EDIT", "PAUSE"]:
		var button := Button.new()
		button.text = title
		button.custom_minimum_size = Vector2(78, 52)
		touch_controls.add_child(button)
	$HUD.add_child(touch_controls)

func _overlay(node_name: String, text: String) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.name = node_name
	panel.set_anchors_preset(Control.PRESET_CENTER)
	panel.position = Vector2(-310, -125)
	panel.custom_minimum_size = Vector2(620, 250)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 28)
	margin.add_theme_constant_override("margin_top", 24)
	margin.add_theme_constant_override("margin_right", 28)
	margin.add_theme_constant_override("margin_bottom", 24)
	panel.add_child(margin)
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", 18)
	margin.add_child(label)
	$HUD.add_child(panel)
	return panel

func _apply_responsive_layout(override_size := Vector2.ZERO) -> void:
	var viewport_size: Vector2 = override_size if override_size != Vector2.ZERO else get_viewport().get_visible_rect().size
	var compact := viewport_size.x / maxf(viewport_size.y, 1.0) < 1.55
	$HUD/TopBar.offset_right = viewport_size.x - 24.0
	$HUD/StatusBar.offset_right = viewport_size.x - 24.0
	$HUD/StatusBar.offset_top = viewport_size.y - 66.0
	$HUD/StatusBar.offset_bottom = viewport_size.y - 16.0
	$HUD/DialoguePanel.offset_left = 36.0 if compact else 94.0
	$HUD/DialoguePanel.offset_right = viewport_size.x - (36.0 if compact else 94.0)
	$HUD/DialoguePanel.offset_top = viewport_size.y - (284.0 if compact else 294.0)
	$HUD/DialoguePanel.offset_bottom = viewport_size.y - 92.0
	touch_controls.visible = compact or OS.has_feature("web_android") or OS.has_feature("web_ios")

func _finish_loading() -> void:
	loading_overlay.visible = false

func _input(event: InputEvent) -> void:
	if not telemetry_decided and event is InputEventKey and event.pressed:
		if event.keycode == KEY_Y:
			choose_telemetry(true)
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_N:
			choose_telemetry(false)
			get_viewport().set_input_as_handled()

func release_snapshot() -> Dictionary:
	return {
		"telemetry_consent": telemetry.consent,
		"telemetry_requests": telemetry.request_count,
		"responsive": true,
		"touch_safe": touch_controls.get_child_count() == 4,
		"settings": accessibility.to_dict(),
		"pause_flow": pause_overlay != null,
		"save_recovery": save_notice != null,
		"survey": open_survey(),
	}
