extends Node2D

const RewireCommandScript = preload("res://scripts/network/rewire_command.gd")
const MissionStateScript = preload("res://scripts/security/mission_state.gd")
const SaveServiceScript = preload("res://scripts/autoload/save_service.gd")
const GameStateScript = preload("res://scripts/narrative/game_state.gd")
const NODE_RADIUS := 40.0
const NODE_ORDER := ["ingress", "identity_gate", "backdoor", "stacks", "quarantine", "containment", "trace_source"]
const MEMORY_NODES := {"stacks": "asha_fragment", "quarantine": "hospice_audit"}

var graph := NetworkGraph.new()
var mission: RefCounted
var save_service := SaveServiceScript.new()
var patrol_route: Array[String] = []
var trace_progress := -1.0
var message := "Choose preparation: [1] stolen identity or [2] hardware backdoor."
var completed := false
var debug_overlay := true
var preview_command: RefCounted

func _ready() -> void:
	_build_graph("identity")
	queue_redraw()

func _build_graph(preparation: String) -> void:
	graph = NetworkGraph.new()
	var positions := {
		"ingress": Vector2(110, 390), "identity_gate": Vector2(315, 230),
		"backdoor": Vector2(315, 550), "stacks": Vector2(550, 390),
		"quarantine": Vector2(770, 390), "containment": Vector2(1030, 390),
		"trace_source": Vector2(770, 130),
	}
	for id in NODE_ORDER:
		graph.add_node(id, positions[id], {"zone": id})
	var port_defs := [
		["ingress_identity", "ingress", "data"], ["identity_in", "identity_gate", "data"],
		["identity_out", "identity_gate", "data"], ["stacks_identity", "stacks", "data"],
		["ingress_backdoor", "ingress", "unstable"], ["backdoor_in", "backdoor", "unstable"],
		["backdoor_out", "backdoor", "unstable"], ["stacks_backdoor", "stacks", "data"],
		["stacks_out", "stacks", "data"], ["quarantine_in", "quarantine", "data"],
		["quarantine_out", "quarantine", "data"], ["containment_in", "containment", "data"],
		["trace_out", "trace_source", "power"], ["quarantine_trace", "quarantine", "power"],
		["trace_data", "trace_source", "data"], ["containment_trace", "containment", "data"],
	]
	for definition in port_defs:
		graph.add_port(definition[0], definition[1], definition[2])
	if preparation == "identity":
		graph.connect_ports("ingress_identity", "identity_in")
		graph.connect_ports("identity_out", "stacks_identity")
	else:
		graph.connect_ports("ingress_backdoor", "backdoor_in")
		graph.connect_ports("backdoor_out", "stacks_backdoor")
	graph.connect_ports("stacks_out", "quarantine_in")
	graph.connect_ports("quarantine_out", "containment_in")
	graph.connect_ports("trace_out", "quarantine_trace")
	graph.connect_ports("trace_data", "containment_trace")
	mission = MissionStateScript.new(graph)
	mission.game_state.preparation = preparation
	mission.game_state.topology = graph.snapshot()
	_recalculate_security()

func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	match event.keycode:
		KEY_1:
			_build_graph("identity")
			message = "Stolen identity selected. Credential path is open."
		KEY_2:
			_build_graph("backdoor")
			message = "Hardware backdoor selected. Unstable path is open."
		KEY_SPACE:
			_advance()
		KEY_M:
			_collect_memory()
		KEY_T:
			_trigger_trace()
		KEY_R:
			_demo_rewire()
		KEY_C:
			_cancel_preview()
		KEY_K:
			_save()
		KEY_L:
			_load()
		KEY_F:
			_finish()
		KEY_F3:
			debug_overlay = not debug_overlay
	queue_redraw()

func _process(delta: float) -> void:
	if trace_progress >= 0.0:
		trace_progress += delta * mission.security_speed()
		if trace_progress >= 1.0:
			var result: Dictionary = mission.complete_trace()
			message = "TRACE: %s. Restored at anchor %s; topology preserved." % [result.consequence.replace("_", " "), mission.checkpoint_node]
			trace_progress = -1.0
			_recalculate_security()
	queue_redraw()

func _advance() -> void:
	if completed:
		return
	var target := ""
	match mission.player_node:
		"ingress":
			target = "identity_gate" if mission.game_state.preparation == "identity" else "backdoor"
		"identity_gate", "backdoor":
			target = "stacks"
		"stacks":
			target = "quarantine"
		"quarantine":
			target = "containment"
	if target == "" or not mission.travel(target):
		message = "No active route forward."
		return
	message = "Entered %s." % target.replace("_", " ").capitalize()
	if target in ["stacks", "quarantine"]:
		mission.activate_anchor(target)
		message += " Anchor committed."
	_recalculate_security()

func _collect_memory() -> void:
	var memory_id: String = MEMORY_NODES.get(mission.player_node, "")
	if memory_id == "":
		message = "No memory shard at this node."
	elif mission.game_state.collect_memory(memory_id):
		message = "Evidence collected: %s." % memory_id.replace("_", " ")
	else:
		message = "That evidence is already in the inventory."

func _trigger_trace() -> void:
	if trace_progress >= 0.0:
		return
	var path: Array[String] = mission.launch_trace("trace_source")
	if path.is_empty():
		message = "Trace redirected: signal cannot reach the player."
		return
	trace_progress = 0.0
	message = "Trace inbound via %s." % " > ".join(path)

func _demo_rewire() -> void:
	if preview_command != null:
		preview_command.commit()
		preview_command = null
		mission.game_state.topology = graph.snapshot()
		message = "Rewire committed. Routes and signals recalculated."
		_recalculate_security()
		return
	preview_command = RewireCommandScript.new(graph)
	var free_port := "stacks_identity" if mission.game_state.preparation == "backdoor" else "stacks_backdoor"
	var result: Dictionary = preview_command.preview(["quarantine_out", "containment_in"], [free_port, "containment_in"])
	message = "Preview valid: press [R] to commit or [C] to cancel." if result.valid else result.reason
	if not result.valid:
		preview_command = null
	_recalculate_security()

func _cancel_preview() -> void:
	if preview_command == null:
		message = "No edit is being previewed."
		return
	preview_command.cancel()
	preview_command = null
	message = "Preview cancelled; graph restored."
	_recalculate_security()

func _finish() -> void:
	if mission.player_node != "containment":
		message = "Reach containment before extraction."
		return
	completed = true
	mission.game_state.final_choice = "contained"
	message = "HEIST COMPLETE // Asha contained pending verification."

func _save() -> void:
	mission.game_state.topology = graph.snapshot()
	message = "Game saved at %s." % mission.checkpoint_node if save_service.save_game(mission.game_state) else "Save failed."

func _load() -> void:
	var loaded: RefCounted = GameStateScript.new()
	if not save_service.load_game(loaded):
		message = "No valid save found."
		return
	_build_graph(loaded.preparation)
	mission.game_state = loaded
	graph.restore(loaded.topology)
	mission.player_node = loaded.checkpoint
	mission.checkpoint_node = loaded.checkpoint
	mission.checkpoint_graph = graph.snapshot()
	message = "Loaded at %s with alert tier %d." % [loaded.checkpoint, loaded.alert_tier]
	_recalculate_security()

func _recalculate_security() -> void:
	patrol_route = graph.shortest_path("trace_source", mission.player_node)

func _draw() -> void:
	draw_string(ThemeDB.fallback_font, Vector2(28, 36), "CONTINUITY ERROR // PHASE 1 HEIST", HORIZONTAL_ALIGNMENT_LEFT, -1, 23, Color("#77f7df"))
	draw_string(ThemeDB.fallback_font, Vector2(28, 66), message, HORIZONTAL_ALIGNMENT_LEFT, 1210, 17, Color("#e4e8ff"))
	draw_string(ThemeDB.fallback_font, Vector2(28, 95), "ROUTE %s  ALERT %d  CHECKPOINT %s  EVIDENCE %d/%d" % [mission.game_state.preparation.to_upper(), mission.game_state.alert_tier, mission.checkpoint_node.to_upper(), mission.game_state.collected_memories.size(), mission.game_state.corrupted_memories.size()], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color("#91a0c4"))
	for connection in graph.connections:
		var a := _port_position(connection[0])
		var b := _port_position(connection[1])
		draw_line(a, b, Color("#3bd6b2"), 5)
		if debug_overlay:
			draw_string(ThemeDB.fallback_font, (a + b) * 0.5, "%s > %s" % [graph.ports[connection[0]].node, graph.ports[connection[1]].node], HORIZONTAL_ALIGNMENT_CENTER, 160, 11, Color("#75aab8"))
	for id in NODE_ORDER:
		var position := graph.node_position(id)
		var color := Color("#66334d") if id == "trace_source" else Color("#19284e")
		if id == mission.player_node:
			color = Color("#644fc2")
		draw_circle(position, NODE_RADIUS, color)
		draw_arc(position, NODE_RADIUS, 0, TAU, 32, Color("#91a9ed"), 3)
		draw_string(ThemeDB.fallback_font, position + Vector2(-60, 5), id.replace("_", " ").to_upper(), HORIZONTAL_ALIGNMENT_CENTER, 120, 12, Color.WHITE)
	for id in graph.ports:
		var position := _port_position(id)
		draw_circle(position, 8, Color("#ffd166") if graph.ports[id].type == "power" else Color("#70e1ff"))
	if trace_progress >= 0.0 and not mission.trace_path.is_empty():
		var index := mini(int(trace_progress * mission.trace_path.size()), mission.trace_path.size() - 1)
		draw_circle(graph.node_position(mission.trace_path[index]), 14, Color("#ff416c"))
	if debug_overlay:
		draw_string(ThemeDB.fallback_font, Vector2(28, 642), "PATROL: %s  | TRACE: %s  | SPEED: %.2fx  | EDIT TOLERANCE: %.0f%%" % [" > ".join(patrol_route), " > ".join(mission.trace_path), mission.security_speed(), mission.edit_tolerance() * 100.0], HORIZONTAL_ALIGNMENT_LEFT, 1220, 13, Color("#ff9aae"))
	draw_string(ThemeDB.fallback_font, Vector2(28, 692), "[1/2] route  [Space] advance  [M] memory  [T] trace  [R] preview/commit  [C] cancel  [K/L] save/load  [F] finish  [F3] debug", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color("#9caad0"))

func _port_position(id: String) -> Vector2:
	var port: Dictionary = graph.ports[id]
	var center := graph.node_position(port.node)
	var siblings: Array = graph.ports.keys().filter(func(key): return graph.ports[key].node == port.node)
	var angle := siblings.find(id) * 1.3
	return center + Vector2(cos(angle), sin(angle)) * (NODE_RADIUS + 12.0)

func state_snapshot() -> Dictionary:
	return {"player_node": mission.player_node, "preparation": mission.game_state.preparation, "alert_tier": mission.game_state.alert_tier, "memories": mission.game_state.collected_memories.duplicate(), "corrupted": mission.game_state.corrupted_memories.duplicate(), "closed_routes": mission.game_state.closed_routes.duplicate(), "completed": completed, "completable": mission.is_completable()}
