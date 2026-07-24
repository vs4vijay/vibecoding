class_name ReleaseCandidate3D
extends ReleaseVerticalSlice3D

const BUILD_ID := "rc1-2026.07.24"
const REPORT_SCHEMA_VERSION := 1

var playtest_session_id := ""
var playtest_started_msec := 0
var milestones: Dictionary = {}
var session_notes: Array[String] = []
var build_label: Label
var report_notice: Label

func _ready() -> void:
	playtest_started_msec = Time.get_ticks_msec()
	playtest_session_id = _make_session_id()
	super()
	_build_candidate_ui()
	_mark_milestone("launch")

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F8:
		save_playtest_report()
		get_viewport().set_input_as_handled()
		return
	super(event)

func visit_contact(index: int) -> bool:
	var accepted := super(index)
	if accepted:
		_mark_milestone("contact_%d" % (index + 1))
	return accepted

func select_preparation(choice: String) -> bool:
	var accepted := super(choice)
	if accepted:
		_mark_milestone("preparation_selected")
	return accepted

func advance_heist() -> bool:
	var accepted := super()
	if accepted and heist != null:
		_mark_milestone("zone_%s" % heist.mission.player_node)
	return accepted

func select_ending(choice: String) -> bool:
	var accepted := super(choice)
	if accepted:
		_mark_milestone("ending_selected")
	return accepted

func advance_dialogue() -> void:
	super()
	if stage == Stage.CREDITS:
		_mark_milestone("credits")
		save_playtest_report()

func add_session_note(code: String) -> bool:
	var allowed := ["movement_confusion", "rewire_confusion", "objective_confusion", "choice_unclear", "technical_issue"]
	if code not in allowed:
		return false
	session_notes.append(code)
	return true

func playtest_report() -> Dictionary:
	var elapsed_seconds := maxi(0, int((Time.get_ticks_msec() - playtest_started_msec) / 1000.0))
	var state := snapshot()
	return {
		"schema_version": REPORT_SCHEMA_VERSION,
		"build_id": BUILD_ID,
		"session_id": playtest_session_id,
		"platform": OS.get_name(),
		"locale": TranslationServer.get_locale().get_slice("_", 0),
		"elapsed_seconds": elapsed_seconds,
		"completed": stage == Stage.CREDITS,
		"preparation": state.preparation,
		"ending": state.final_choice,
		"alert_tier": state.alert_tier,
		"memories_collected": state.memories.size(),
		"memories_corrupted": state.corrupted.size(),
		"milestones": milestones.duplicate(true),
		"issue_codes": session_notes.duplicate(),
		"contains_personal_data": false,
	}

func save_playtest_report(path := "") -> bool:
	var target := path
	if target.is_empty():
		target = "user://playtest-%s.json" % playtest_session_id
	var file := FileAccess.open(target, FileAccess.WRITE)
	if file == null:
		if report_notice != null:
			report_notice.text = "PLAYTEST REPORT COULD NOT BE SAVED"
			report_notice.visible = true
		return false
	file.store_string(JSON.stringify(playtest_report(), "\t"))
	if report_notice != null:
		report_notice.text = "PLAYTEST REPORT SAVED LOCALLY // %s" % playtest_session_id
		report_notice.visible = true
	return true

func candidate_snapshot() -> Dictionary:
	return {
		"build_id": BUILD_ID,
		"session_id": playtest_session_id,
		"report_schema": REPORT_SCHEMA_VERSION,
		"report_hotkey": "F8",
		"personal_data": false,
		"milestones": milestones.duplicate(true),
	}

func _build_candidate_ui() -> void:
	build_label = Label.new()
	build_label.name = "BuildLabel"
	build_label.text = "RELEASE CANDIDATE // %s" % BUILD_ID.to_upper()
	build_label.set_anchors_preset(Control.PRESET_TOP_LEFT)
	build_label.position = Vector2(24, 2)
	build_label.add_theme_font_size_override("font_size", 12)
	build_label.add_theme_color_override("font_color", Color("55dbea"))
	$HUD.add_child(build_label)

	report_notice = Label.new()
	report_notice.name = "ReportNotice"
	report_notice.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	report_notice.position = Vector2(-520, 2)
	report_notice.size = Vector2(496, 24)
	report_notice.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	report_notice.add_theme_font_size_override("font_size", 12)
	report_notice.add_theme_color_override("font_color", Color("fff36b"))
	report_notice.visible = false
	$HUD.add_child(report_notice)

func _mark_milestone(name: String) -> void:
	if milestones.has(name):
		return
	milestones[name] = maxi(0, Time.get_ticks_msec() - playtest_started_msec)

func _make_session_id() -> String:
	return "%08x-%08x" % [randi(), Time.get_ticks_msec()]
