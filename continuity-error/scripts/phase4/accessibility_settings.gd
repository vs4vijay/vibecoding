class_name AccessibilitySettings
extends RefCounted

const MIN_SCALE := 0.8
const MAX_SCALE := 1.5

var ui_scale := 1.0
var subtitle_scale := 1.0
var reduced_motion := false
var reduced_flashing := false
var high_contrast_topology := false
var music_level := 0.8
var effects_level := 0.8
var voice_level := 1.0

func set_ui_scale(value: float) -> void:
	ui_scale = clampf(value, MIN_SCALE, MAX_SCALE)

func set_subtitle_scale(value: float) -> void:
	subtitle_scale = clampf(value, MIN_SCALE, MAX_SCALE)

func set_audio_levels(music: float, effects: float, voice: float) -> void:
	music_level = clampf(music, 0.0, 1.0)
	effects_level = clampf(effects, 0.0, 1.0)
	voice_level = clampf(voice, 0.0, 1.0)

func remap_action(action: StringName, event: InputEvent) -> bool:
	if not InputMap.has_action(action) or event == null:
		return false
	InputMap.action_erase_events(action)
	InputMap.action_add_event(action, event)
	return true

func to_dict() -> Dictionary:
	return {
		"ui_scale": ui_scale,
		"subtitle_scale": subtitle_scale,
		"reduced_motion": reduced_motion,
		"reduced_flashing": reduced_flashing,
		"high_contrast_topology": high_contrast_topology,
		"music_level": music_level,
		"effects_level": effects_level,
		"voice_level": voice_level,
	}

func load_dict(data: Dictionary) -> void:
	set_ui_scale(float(data.get("ui_scale", 1.0)))
	set_subtitle_scale(float(data.get("subtitle_scale", 1.0)))
	reduced_motion = bool(data.get("reduced_motion", false))
	reduced_flashing = bool(data.get("reduced_flashing", false))
	high_contrast_topology = bool(data.get("high_contrast_topology", false))
	set_audio_levels(
		float(data.get("music_level", 0.8)),
		float(data.get("effects_level", 0.8)),
		float(data.get("voice_level", 1.0))
	)
