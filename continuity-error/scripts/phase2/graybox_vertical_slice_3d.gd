class_name GrayboxVerticalSlice3D
extends Node3D

const DialogueCatalogScript = preload("res://scripts/narrative/dialogue_catalog.gd")
const HeistScene = preload("res://scenes/phase1_core_heist.tscn")

enum Stage { OPENING, HUB, PREPARATION, HEIST, EXTRACTION, AFTERMATH, CREDITS }

const CONTACTS := ["fixer", "employee", "technician"]
const CONTACT_NAMES := {"fixer": "VALE // FIXER", "employee": "SURI // HOSPICE EMPLOYEE", "technician": "MOTH // STREET TECHNICIAN"}
const ZONE_NAMES := {
	"ingress": "01 // INGRESS",
	"identity_gate": "02 // IDENTITY GATE",
	"backdoor": "02 // UNSTABLE MAINTENANCE",
	"stacks": "03 // MEMORY STACKS",
	"quarantine": "04 // QUARANTINE LATTICE",
	"containment": "05 // ASHA CONTAINMENT",
}

var stage := Stage.OPENING
var catalog := DialogueCatalogScript.new()
var dialogue: Array = []
var dialogue_index := 0
var contacts_seen: Array[String] = []
var preparation := ""
var final_choice := ""
var heist: Node3D
var objective := "Read Asha's message."
var status_message := ""
var selected_contact := 0

@onready var hub_world: Node3D = $HubWorld
@onready var mission_mount: Node3D = $MissionMount
@onready var camera: Camera3D = $Camera3D
@onready var stage_label: Label = $HUD/TopBar/Margin/Row/Stage
@onready var objective_label: Label = $HUD/ObjectivePanel/Margin/Objective
@onready var dialogue_panel: PanelContainer = $HUD/DialoguePanel
@onready var speaker_label: Label = $HUD/DialoguePanel/Margin/Content/Speaker
@onready var dialogue_label: Label = $HUD/DialoguePanel/Margin/Content/Line
@onready var dialogue_progress: Label = $HUD/DialoguePanel/Margin/Content/Progress
@onready var choices: VBoxContainer = $HUD/ChoicePanel/Margin/Choices
@onready var status_label: Label = $HUD/StatusBar/Margin/Status
@onready var evidence_label: Label = $HUD/TopBar/Margin/Row/Evidence
@onready var fade: ColorRect = $HUD/Fade

func _ready() -> void:
	_build_hub()
	_start_dialogue("opening")
	_refresh()

func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	if not dialogue.is_empty():
		if event.keycode in [KEY_ENTER, KEY_SPACE]:
			advance_dialogue()
		return
	match stage:
		Stage.HUB:
			if event.keycode in [KEY_1, KEY_2, KEY_3]:
				visit_contact(event.keycode - KEY_1)
			elif event.keycode == KEY_P:
				begin_preparation()
		Stage.PREPARATION:
			if event.keycode == KEY_1:
				select_preparation("identity")
			elif event.keycode == KEY_2:
				select_preparation("backdoor")
		Stage.HEIST:
			if event.keycode == KEY_SPACE:
				advance_heist()
			elif event.keycode == KEY_M:
				collect_evidence()
			elif event.keycode == KEY_T:
				trigger_trace()
			elif event.keycode == KEY_R:
				heist.preview_or_commit_rewire()
				status_message = heist.message
		Stage.EXTRACTION:
			if event.keycode == KEY_F:
				select_ending("free")
			elif event.keycode == KEY_C:
				select_ending("contain")
		Stage.AFTERMATH:
			if event.keycode in [KEY_ENTER, KEY_SPACE]:
				_enter_credits()
	_refresh()

func advance_dialogue() -> void:
	if dialogue.is_empty():
		return
	dialogue_index += 1
	if dialogue_index < dialogue.size():
		_refresh()
		return
	dialogue.clear()
	dialogue_index = 0
	match stage:
		Stage.OPENING:
			stage = Stage.HUB
			objective = "Meet all three contacts, then prepare at Nera's rig."
		Stage.HUB:
			objective = "Contacts met: %d/3. Press P at the rig when ready." % contacts_seen.size()
		Stage.PREPARATION:
			_start_heist()
		Stage.EXTRACTION:
			objective = "Choose Asha's fate: [F] FREE  or  [C] CONTAIN"
		Stage.AFTERMATH:
			_enter_credits()
	_refresh()

func visit_contact(index: int) -> bool:
	if stage != Stage.HUB or index < 0 or index >= CONTACTS.size():
		return false
	selected_contact = index
	var id: String = CONTACTS[index]
	if id not in contacts_seen:
		contacts_seen.append(id)
	_start_dialogue(id)
	_refresh()
	return true

func begin_preparation() -> bool:
	if stage != Stage.HUB:
		return false
	if contacts_seen.size() < CONTACTS.size():
		status_message = "Preparation locked: meet Vale, Suri, and Moth."
		_refresh()
		return false
	stage = Stage.PREPARATION
	objective = "Select one access package. This changes access and starting danger."
	status_message = ""
	_refresh()
	return true

func select_preparation(choice: String) -> bool:
	if stage != Stage.PREPARATION or choice not in ["identity", "backdoor"]:
		return false
	preparation = choice
	_start_dialogue("brief_%s" % choice)
	_refresh()
	return true

func _start_heist() -> void:
	hub_world.visible = false
	heist = HeistScene.instantiate()
	mission_mount.add_child(heist)
	heist.set_process_unhandled_input(false)
	heist.get_node("HUD").visible = false
	heist.select_preparation(preparation)
	stage = Stage.HEIST
	camera.current = false
	heist.get_node("Camera3D").current = true
	objective = "INGRESS // Follow the active connection. [SPACE] traverse"
	_start_dialogue("ingress")

func advance_heist() -> bool:
	if stage != Stage.HEIST or heist == null:
		return false
	var before: String = heist.mission.player_node
	if not heist.advance():
		status_message = heist.message
		_refresh()
		return false
	var node: String = heist.mission.player_node
	if node == before:
		return false
	objective = "%s // %s" % [ZONE_NAMES.get(node, node.to_upper()), _zone_instruction(node)]
	var dialogue_id := node
	if node in ["identity_gate", "backdoor"]:
		dialogue_id = "identity_gate_%s" % preparation
	if node == "containment":
		stage = Stage.EXTRACTION
		dialogue_id = "containment"
	_start_dialogue(dialogue_id)
	_refresh()
	return true

func collect_evidence() -> bool:
	if stage != Stage.HEIST or heist == null:
		return false
	var before: int = heist.mission.game_state.collected_memories.size()
	heist.collect_memory()
	var collected: bool = heist.mission.game_state.collected_memories.size() > before
	status_message = heist.message
	_refresh()
	return collected

func trigger_trace() -> bool:
	if stage != Stage.HEIST or heist == null:
		return false
	var result: Dictionary = heist.resolve_trace_immediately()
	status_message = "TRACE RESOLVED // %s // alert tier %d" % [
		str(result.get("consequence", "blocked")).replace("_", " ").to_upper(),
		heist.mission.game_state.alert_tier,
	]
	_refresh()
	return result.get("consequence", "blocked") != "blocked"

func select_ending(choice: String) -> bool:
	if stage != Stage.EXTRACTION or choice not in ["free", "contain"]:
		return false
	final_choice = choice
	heist.mission.game_state.final_choice = choice
	stage = Stage.AFTERMATH
	mission_mount.visible = false
	hub_world.visible = true
	camera.current = true
	objective = "HUB AFTERMATH // consequences persist"
	_apply_aftermath_world()
	_start_dialogue(catalog.aftermath_id(preparation, choice))
	_refresh()
	return true

func _enter_credits() -> void:
	stage = Stage.CREDITS
	dialogue.clear()
	objective = "VERTICAL SLICE COMPLETE"
	status_message = "%s ROUTE // ASHA %s" % [preparation.to_upper(), "RELEASED" if final_choice == "free" else "CONTAINED"]
	_refresh()

func _start_dialogue(id: String) -> void:
	dialogue = catalog.get_lines(id)
	dialogue_index = 0
	status_message = ""

func _zone_instruction(node: String) -> String:
	match node:
		"identity_gate":
			return "Credential accepted; constrained route open. [SPACE]"
		"backdoor":
			return "Unstable bypass active; patrols accelerate. [SPACE]"
		"stacks":
			return "Supporting evidence nearby. [M] collect, [SPACE] continue"
		"quarantine":
			return "Contradictory audit nearby. [M] collect, [SPACE] continue"
		_:
			return "[SPACE] continue"

func _build_hub() -> void:
	var workshop_floor := _box("WorkshopFloor", Vector3(18, 0.3, 12), Vector3(0, -0.15, 0), Color("172236"))
	hub_world.add_child(workshop_floor)
	for wall_data in [
		[Vector3(18, 3.2, 0.3), Vector3(0, 1.6, -6)],
		[Vector3(0.3, 3.2, 12), Vector3(-9, 1.6, 0)],
		[Vector3(0.3, 3.2, 12), Vector3(9, 1.6, 0)],
		[Vector3(5.5, 2.5, 0.25), Vector3(-5.8, 1.25, 0.8)],
		[Vector3(5.5, 2.5, 0.25), Vector3(3.2, 1.25, -1.3)],
	]:
		hub_world.add_child(_box("Occluder", wall_data[0], wall_data[1], Color("243149")))
	var room_data := [
		["NERA'S RIG", Vector3(-5.8, 0.25, -3.7), Color("24b6a8")],
		["VALE", Vector3(5.8, 0.25, -3.7), Color("df9c4b")],
		["SURI", Vector3(-5.8, 0.25, 3.7), Color("7a8bea")],
		["MOTH", Vector3(5.8, 0.25, 3.7), Color("db577f")],
	]
	for item in room_data:
		var platform := _box(str(item[0]), Vector3(3.2, 0.45, 2.4), item[1], item[2])
		hub_world.add_child(platform)
		var beacon := _box("Beacon", Vector3(0.22, 2.2, 0.22), item[1] + Vector3(0, 1.2, 0), item[2], true)
		hub_world.add_child(beacon)

func _apply_aftermath_world() -> void:
	var color := Color("42e8c4") if final_choice == "free" else Color("e05b78")
	var marker := _box("AftermathSignal", Vector3(7.5, 0.12, 7.5), Vector3(0, 0.08, 0), color, true)
	hub_world.add_child(marker)

func _box(node_name: String, size: Vector3, world_position: Vector3, color: Color, emission := false) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = node_name
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.position = world_position
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.72
	if emission:
		material.emission_enabled = true
		material.emission = color * 0.7
	node.material_override = material
	return node

func _refresh() -> void:
	if not is_instance_valid(stage_label):
		return
	stage_label.text = "PHASE 2 // %s" % Stage.keys()[stage]
	objective_label.text = objective
	status_label.text = status_message if not status_message.is_empty() else "The hospice provides evidence, not certainty."
	var evidence := 0
	var corrupted := 0
	var alert := 0
	if heist != null:
		evidence = heist.mission.game_state.collected_memories.size()
		corrupted = heist.mission.game_state.corrupted_memories.size()
		alert = heist.mission.game_state.alert_tier
	evidence_label.text = "CONTACTS %d/3   ROUTE %s   ALERT %d   EVIDENCE %d   CORRUPT %d" % [
		contacts_seen.size(), preparation.to_upper() if not preparation.is_empty() else "UNSET", alert, evidence, corrupted,
	]
	dialogue_panel.visible = not dialogue.is_empty()
	if not dialogue.is_empty():
		var line: Array = dialogue[dialogue_index]
		speaker_label.text = str(line[0])
		dialogue_label.text = str(line[1])
		dialogue_progress.text = "[ENTER / SPACE] CONTINUE    %d/%d" % [dialogue_index + 1, dialogue.size()]
	for child in choices.get_children():
		child.queue_free()
	if dialogue.is_empty():
		for text in _choice_lines():
			var label := Label.new()
			label.text = text
			label.add_theme_font_size_override("font_size", 17)
			label.add_theme_color_override("font_color", Color("9ae9e0"))
			choices.add_child(label)
	fade.visible = false

func _choice_lines() -> Array[String]:
	match stage:
		Stage.HUB:
			var result: Array[String] = []
			for index in CONTACTS.size():
				var id: String = CONTACTS[index]
				result.append("[%d] %s%s" % [index + 1, CONTACT_NAMES[id], "  ✓ MET" if id in contacts_seen else ""])
			result.append("[P] PREPARE AT NERA'S RIG")
			return result
		Stage.PREPARATION:
			return ["[1] STOLEN IDENTITY — safer, constrained credential route", "[2] HARDWARE BACKDOOR — flexible, starts at alert tier 1"]
		Stage.HEIST:
			return ["[SPACE] TRAVERSE    [M] COLLECT EVIDENCE    [T] TRIGGER TRACE    [R] REWIRE"]
		Stage.EXTRACTION:
			return ["[F] FREE ASHA — grant network autonomy", "[C] CONTAIN ASHA — preserve her pending verification"]
		Stage.AFTERMATH:
			return ["[ENTER] CONTINUE TO CREDITS"]
		Stage.CREDITS:
			return ["NERA VOSS // ASHA RHYNE", "PREPARATION: %s    DECISION: %s" % [preparation.to_upper(), final_choice.to_upper()], "END OF GRAY-BOX VERTICAL SLICE"]
	return []

func snapshot() -> Dictionary:
	return {
		"stage": stage,
		"contacts": contacts_seen.duplicate(),
		"preparation": preparation,
		"final_choice": final_choice,
		"dialogue_active": not dialogue.is_empty(),
		"player_node": heist.mission.player_node if heist != null else "",
		"alert_tier": heist.mission.game_state.alert_tier if heist != null else 0,
		"memories": heist.mission.game_state.collected_memories.duplicate() if heist != null else [],
		"corrupted": heist.mission.game_state.corrupted_memories.duplicate() if heist != null else [],
		"is_3d": true,
	}
