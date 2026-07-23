extends Node2D

const DialogueCatalogScript = preload("res://scripts/narrative/dialogue_catalog.gd")
const HeistScene = preload("res://scenes/heist_room.tscn")

enum Stage { OPENING, HUB, PREPARATION, HEIST, EXTRACTION, AFTERMATH, CREDITS }

var stage := Stage.OPENING
var catalog := DialogueCatalogScript.new()
var dialogue: Array = []
var dialogue_index := 0
var contacts_seen: Array[String] = []
var preparation := ""
var final_choice := ""
var heist: Node
var objective := "Read Asha's message."
var status_message := ""

func _ready() -> void:
	_start_dialogue("opening")
	queue_redraw()

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
				heist._trigger_trace()
		Stage.EXTRACTION:
			if event.keycode == KEY_F:
				select_ending("free")
			elif event.keycode == KEY_C:
				select_ending("contain")
		Stage.AFTERMATH:
			if event.keycode == KEY_ENTER:
				stage = Stage.CREDITS
				objective = "Vertical slice complete."
	queue_redraw()

func advance_dialogue() -> void:
	if dialogue.is_empty():
		return
	dialogue_index += 1
	if dialogue_index < dialogue.size():
		queue_redraw()
		return
	dialogue.clear()
	dialogue_index = 0
	match stage:
		Stage.OPENING:
			stage = Stage.HUB
			objective = "Meet Vale, Suri, and Moth. Then press P to prepare."
		Stage.HUB:
			objective = "Contacts met: %d/3. Press P when ready." % contacts_seen.size()
		Stage.PREPARATION:
			_start_heist()
		Stage.HEIST:
			pass
		Stage.EXTRACTION:
			objective = "Choose: [F] free Asha or [C] contain her."
		Stage.AFTERMATH:
			stage = Stage.CREDITS
			objective = "Vertical slice complete."
	queue_redraw()

func visit_contact(index: int) -> bool:
	if stage != Stage.HUB or index < 0 or index > 2:
		return false
	var ids := ["fixer", "employee", "technician"]
	var id: String = ids[index]
	if id not in contacts_seen:
		contacts_seen.append(id)
	_start_dialogue(id)
	return true

func begin_preparation() -> bool:
	if stage != Stage.HUB:
		return false
	if contacts_seen.size() < 3:
		status_message = "Meet all three contacts before committing."
		queue_redraw()
		return false
	stage = Stage.PREPARATION
	objective = "Choose [1] stolen identity or [2] hardware backdoor."
	status_message = ""
	queue_redraw()
	return true

func select_preparation(choice: String) -> bool:
	if stage != Stage.PREPARATION or choice not in ["identity", "backdoor"]:
		return false
	preparation = choice
	_start_dialogue("brief_%s" % choice)
	return true

func _start_heist() -> void:
	heist = HeistScene.instantiate()
	add_child(heist)
	heist.visible = false
	heist.set_process_unhandled_input(false)
	heist._build_graph(preparation)
	if preparation == "backdoor":
		heist.mission.game_state.alert_tier = 1
	stage = Stage.HEIST
	objective = "INGRESS // Press Space to traverse the active route."
	_start_dialogue("ingress")

func advance_heist() -> bool:
	if stage != Stage.HEIST or heist == null:
		return false
	var before: String = heist.mission.player_node
	heist._advance()
	var node: String = heist.mission.player_node
	if node == before:
		status_message = "No active route forward."
		return false
	objective = "%s // %s" % [node.replace("_", " ").to_upper(), _zone_instruction(node)]
	var dialogue_id := node
	if node in ["identity_gate", "backdoor"]:
		dialogue_id = "identity_gate_%s" % preparation
	if node == "containment":
		stage = Stage.EXTRACTION
		dialogue_id = "containment"
	_start_dialogue(dialogue_id)
	queue_redraw()
	return true

func collect_evidence() -> bool:
	if stage != Stage.HEIST or heist == null:
		return false
	var count: int = heist.mission.game_state.collected_memories.size()
	heist._collect_memory()
	var collected: bool = heist.mission.game_state.collected_memories.size() > count
	status_message = heist.message
	queue_redraw()
	return collected

func select_ending(choice: String) -> bool:
	if stage != Stage.EXTRACTION or choice not in ["free", "contain"]:
		return false
	final_choice = choice
	heist.mission.game_state.final_choice = choice
	heist.mission.game_state.current_scene = "aftermath"
	stage = Stage.AFTERMATH
	objective = "Return to the hub."
	_start_dialogue(catalog.aftermath_id(preparation, choice))
	return true

func _start_dialogue(id: String) -> void:
	dialogue = catalog.get_lines(id)
	dialogue_index = 0
	status_message = ""
	queue_redraw()

func _zone_instruction(node: String) -> String:
	match node:
		"identity_gate", "backdoor":
			return "Access route accepted. Press Space."
		"stacks":
			return "Evidence supports Asha. Press M, then Space."
		"quarantine":
			return "Evidence undermines Asha. Press M, then Space."
		_:
			return "Press Space."

func _draw() -> void:
	draw_rect(Rect2(0, 0, 1280, 720), Color("#050916"))
	draw_string(ThemeDB.fallback_font, Vector2(46, 54), "CONTINUITY ERROR", HORIZONTAL_ALIGNMENT_LEFT, -1, 30, Color("#78f8df"))
	draw_string(ThemeDB.fallback_font, Vector2(46, 83), _stage_name(), HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("#8798c5"))
	draw_rect(Rect2(46, 112, 1188, 430), Color("#0d1730"), true)
	draw_rect(Rect2(46, 112, 1188, 430), Color("#394b78"), false, 2)
	if not dialogue.is_empty():
		var line: Array = dialogue[dialogue_index]
		draw_string(ThemeDB.fallback_font, Vector2(82, 180), str(line[0]), HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color("#ffcb70"))
		draw_multiline_string(ThemeDB.fallback_font, Vector2(82, 230), str(line[1]), HORIZONTAL_ALIGNMENT_LEFT, 1080, 24, 22, Color("#edf1ff"))
		draw_string(ThemeDB.fallback_font, Vector2(82, 500), "[Enter / Space] continue  %d/%d" % [dialogue_index + 1, dialogue.size()], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color("#91a0c4"))
	else:
		draw_multiline_string(ThemeDB.fallback_font, Vector2(82, 180), objective, HORIZONTAL_ALIGNMENT_LEFT, 1080, 24, 21, Color("#edf1ff"))
		if stage == Stage.HUB:
			draw_string(ThemeDB.fallback_font, Vector2(82, 255), "[1] Vale — fixer%s" % _met("fixer"), HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("#7de5ff"))
			draw_string(ThemeDB.fallback_font, Vector2(82, 295), "[2] Suri — hospice employee%s" % _met("employee"), HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("#7de5ff"))
			draw_string(ThemeDB.fallback_font, Vector2(82, 335), "[3] Moth — street technician%s" % _met("technician"), HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("#7de5ff"))
		elif stage == Stage.CREDITS:
			draw_string(ThemeDB.fallback_font, Vector2(82, 265), "NERA VOSS // ASHA RHYNE // END OF VERTICAL SLICE", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color("#ffcb70"))
			draw_string(ThemeDB.fallback_font, Vector2(82, 315), "Preparation: %s   Decision: %s" % [preparation, final_choice], HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color("#aebce4"))
		if status_message != "":
			draw_string(ThemeDB.fallback_font, Vector2(82, 490), status_message, HORIZONTAL_ALIGNMENT_LEFT, 1080, 16, Color("#ff9aae"))
	var evidence := 0
	var corrupt := 0
	var alert := 0
	if heist != null:
		evidence = heist.mission.game_state.collected_memories.size()
		corrupt = heist.mission.game_state.corrupted_memories.size()
		alert = heist.mission.game_state.alert_tier
	draw_string(ThemeDB.fallback_font, Vector2(46, 590), "CONTACTS %d/3   ROUTE %s   ALERT %d   EVIDENCE %d   CORRUPTED %d" % [contacts_seen.size(), preparation.to_upper() if preparation else "UNSET", alert, evidence, corrupt], HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("#91a0c4"))
	draw_string(ThemeDB.fallback_font, Vector2(46, 675), "All dialogue is subtitled. The hospice provides evidence, not certainty.", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color("#6679aa"))

func _stage_name() -> String:
	return Stage.keys()[stage].replace("_", " ")

func _met(id: String) -> String:
	return "  [MET]" if id in contacts_seen else ""

func snapshot() -> Dictionary:
	return {
		"stage": stage, "contacts": contacts_seen.duplicate(), "preparation": preparation,
		"final_choice": final_choice, "dialogue_active": not dialogue.is_empty(),
		"player_node": heist.mission.player_node if heist != null else "",
		"alert_tier": heist.mission.game_state.alert_tier if heist != null else 0,
		"memories": heist.mission.game_state.collected_memories.duplicate() if heist != null else [],
	}
