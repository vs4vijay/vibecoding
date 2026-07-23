class_name CoreHeist3D
extends Node3D

const RewireCommandScript = preload("res://scripts/network/rewire_command.gd")
const MissionStateScript = preload("res://scripts/security/mission_state.gd")
const SaveServiceScript = preload("res://scripts/autoload/save_service.gd")
const GameStateScript = preload("res://scripts/narrative/game_state.gd")

const NODE_ORDER := ["ingress", "identity_gate", "backdoor", "stacks", "quarantine", "containment", "trace_source"]
const NODE_POSITIONS := {
	"ingress": Vector3(-8.0, 0.3, 3.0),
	"identity_gate": Vector3(-4.3, 0.8, -1.8),
	"backdoor": Vector3(-3.8, 0.3, 5.0),
	"stacks": Vector3(0.0, 1.3, 1.2),
	"quarantine": Vector3(4.2, 0.3, 1.2),
	"containment": Vector3(8.0, 0.8, 1.2),
	"trace_source": Vector3(4.2, 2.0, -4.2),
}
const MEMORY_NODES := {"stacks": "asha_fragment", "quarantine": "hospice_audit"}
const ALERT_NAMES := ["QUIET", "SEARCHING", "LOCKDOWN"]

var graph := NetworkGraph.new()
var mission: RefCounted
var save_service := SaveServiceScript.new()
var preview_command: RefCounted
var patrol_route: Array[String] = []
var patrol_index := 1
var trace_progress := -1.0
var completed := false
var debug_overlay := true
var message := "Select a route: [1] stolen identity  [2] hardware backdoor"

@onready var player: MeshInstance3D = $Actors/Player
@onready var patrol: MeshInstance3D = $Actors/Patrol
@onready var trace_pulse: MeshInstance3D = $Actors/TracePulse
@onready var links: Node3D = $Graph/Links
@onready var nodes: Node3D = $Graph/Nodes
@onready var ports: Node3D = $Graph/Ports
@onready var signals: Node3D = $Graph/Signals
@onready var status_label: Label = $HUD/StatusPanel/Margin/VBox/Status
@onready var state_label: Label = $HUD/StatusPanel/Margin/VBox/State
@onready var debug_label: Label = $HUD/DebugPanel/Margin/Debug
@onready var objective_label: Label = $HUD/ObjectivePanel/Margin/VBox/Objective

func _ready() -> void:
	_build_graph("identity")
	_build_environment()
	_refresh_all()

func _process(delta: float) -> void:
	_move_patrol(delta)
	if trace_progress >= 0.0:
		trace_progress += delta * mission.security_speed() * 0.28
		_update_trace_visual()
		if trace_progress >= 1.0:
			var result: Dictionary = mission.complete_trace()
			message = "TRACE HIT: %s. Restored at %s; topology preserved." % [
				result.consequence.replace("_", " ").to_upper(),
				mission.checkpoint_node.replace("_", " ").to_upper(),
			]
			trace_progress = -1.0
			trace_pulse.visible = false
			_recalculate_security()
			_refresh_all()

func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	match event.keycode:
		KEY_1:
			select_preparation("identity")
		KEY_2:
			select_preparation("backdoor")
		KEY_SPACE:
			advance()
		KEY_M:
			collect_memory()
		KEY_T:
			trigger_trace()
		KEY_R:
			preview_or_commit_rewire()
		KEY_C:
			cancel_rewire()
		KEY_K:
			save_game()
		KEY_L:
			load_game()
		KEY_F3:
			debug_overlay = not debug_overlay
			_refresh_hud()

func select_preparation(preparation: String) -> bool:
	if preparation not in ["identity", "backdoor"]:
		return false
	_build_graph(preparation)
	message = "STOLEN IDENTITY: credential corridor authorized." if preparation == "identity" else "HARDWARE BACKDOOR: unstable bypass active; starting alert increased."
	_refresh_all()
	return true

func advance() -> bool:
	if completed:
		return false
	var target := ""
	match mission.player_node:
		"ingress":
			target = "identity_gate" if mission.game_state.preparation == "identity" else "backdoor"
		"identity_gate", "backdoor":
			target = "stacks"
		"stacks":
			target = "containment" if mission.can_travel("containment") else "quarantine"
		"quarantine":
			target = "containment"
	if target.is_empty() or not mission.travel(target):
		message = "No active route forward. Rewire or restore at an anchor."
		_refresh_hud()
		return false
	player.position = NODE_POSITIONS[target] + Vector3.UP * 0.85
	message = "Entered %s." % target.replace("_", " ").to_upper()
	if target in ["stacks", "quarantine"]:
		mission.activate_anchor(target)
		message += " NETWORK ANCHOR COMMITTED."
	if target == "containment":
		completed = true
		mission.game_state.final_choice = "contained"
		message = "MECHANICS LOOP COMPLETE // Containment reached through %s route." % mission.game_state.preparation
	_recalculate_security()
	_refresh_all()
	return true

func collect_memory() -> bool:
	var memory_id: String = MEMORY_NODES.get(mission.player_node, "")
	if memory_id.is_empty():
		message = "No memory shard at this anchor."
		_refresh_hud()
		return false
	var collected: bool = mission.game_state.collect_memory(memory_id)
	message = "EVIDENCE STORED: %s" % memory_id.replace("_", " ").to_upper() if collected else "Evidence already stored."
	_refresh_all()
	return collected

func trigger_trace() -> bool:
	if trace_progress >= 0.0:
		return false
	var path: Array[String] = mission.launch_trace("trace_source")
	if path.is_empty():
		message = "TRACE BLOCKED // signal has no route to the player."
		_refresh_hud()
		return false
	trace_progress = 0.0
	trace_pulse.visible = true
	message = "TRACE INBOUND: %s" % " > ".join(path).to_upper()
	_refresh_hud()
	return true

func resolve_trace_immediately() -> Dictionary:
	var path: Array[String] = mission.launch_trace("trace_source")
	if path.is_empty():
		return {"consequence": "blocked"}
	var result: Dictionary = mission.complete_trace()
	player.position = NODE_POSITIONS[mission.player_node] + Vector3.UP * 0.85
	trace_progress = -1.0
	trace_pulse.visible = false
	_recalculate_security()
	_refresh_all()
	return result

func preview_or_commit_rewire() -> bool:
	if preview_command != null:
		var committed: bool = preview_command.commit()
		preview_command = null
		if committed:
			mission.game_state.topology = graph.snapshot()
			message = "REWIRE COMMITTED // traversal, patrol, and signal paths recalculated."
		_recalculate_security()
		_refresh_all()
		return committed
	preview_command = RewireCommandScript.new(graph)
	var free_port := "stacks_identity" if mission.game_state.preparation == "backdoor" else "stacks_backdoor"
	var removed: Array[String] = ["quarantine_out", "containment_in"]
	var added: Array[String] = [free_port, "containment_in"]
	var result: Dictionary = preview_command.preview(removed, added)
	if not result.valid:
		preview_command = null
		message = "INVALID EDIT // %s // graph unchanged." % result.reason
		_refresh_hud()
		return false
	message = "PREVIEW // cyan route is pending. [R] commit  [C] cancel."
	_recalculate_security()
	_refresh_all()
	return true

func cancel_rewire() -> bool:
	if preview_command == null:
		message = "No pending topology edit."
		_refresh_hud()
		return false
	preview_command.cancel()
	preview_command = null
	message = "EDIT CANCELLED // exact graph snapshot restored."
	_recalculate_security()
	_refresh_all()
	return true

func save_game(path := SaveServiceScript.DEFAULT_PATH) -> bool:
	mission.game_state.topology = graph.snapshot()
	var saved: bool = save_service.save_game(mission.game_state, path)
	message = "SAVED at %s." % mission.checkpoint_node.to_upper() if saved else "SAVE FAILED."
	_refresh_hud()
	return saved

func load_game(path := SaveServiceScript.DEFAULT_PATH) -> bool:
	var loaded: RefCounted = GameStateScript.new()
	if not save_service.load_game(loaded, path):
		message = "No compatible save found."
		_refresh_hud()
		return false
	_build_graph(loaded.preparation)
	mission.game_state = loaded
	graph.restore(loaded.topology)
	mission.player_node = loaded.checkpoint
	mission.checkpoint_node = loaded.checkpoint
	mission.checkpoint_graph = graph.snapshot()
	completed = loaded.final_choice != ""
	player.position = NODE_POSITIONS[mission.player_node] + Vector3.UP * 0.85
	message = "LOADED // %s // alert tier %d." % [loaded.checkpoint.to_upper(), loaded.alert_tier]
	_recalculate_security()
	_refresh_all()
	return true

func invalid_edit_preserves_state() -> bool:
	var before := graph.snapshot()
	var command := RewireCommandScript.new(graph)
	var removed: Array[String] = []
	var added: Array[String] = ["trace_out", "containment_in"]
	var result: Dictionary = command.preview(removed, added)
	return not result.valid and graph.snapshot() == before

func state_snapshot() -> Dictionary:
	return {
		"player_node": mission.player_node,
		"preparation": mission.game_state.preparation,
		"alert_tier": mission.game_state.alert_tier,
		"checkpoint": mission.checkpoint_node,
		"topology": graph.snapshot(),
		"memories": mission.game_state.collected_memories.duplicate(),
		"corrupted": mission.game_state.corrupted_memories.duplicate(),
		"closed_routes": mission.game_state.closed_routes.duplicate(),
		"patrol_route": patrol_route.duplicate(),
		"completed": completed,
		"completable": mission.is_completable(),
	}

func _build_graph(preparation: String) -> void:
	graph = NetworkGraph.new()
	for id in NODE_ORDER:
		graph.add_node(id, Vector2(NODE_POSITIONS[id].x, NODE_POSITIONS[id].z), {"zone": id, "height": NODE_POSITIONS[id].y})
	var definitions := [
		["ingress_identity", "ingress", "data"], ["identity_in", "identity_gate", "data"],
		["identity_out", "identity_gate", "data"], ["stacks_identity", "stacks", "data"],
		["ingress_backdoor", "ingress", "unstable"], ["backdoor_in", "backdoor", "unstable"],
		["backdoor_out", "backdoor", "unstable"], ["stacks_backdoor", "stacks", "data"],
		["stacks_out", "stacks", "data"], ["quarantine_in", "quarantine", "data"],
		["quarantine_out", "quarantine", "data"], ["containment_in", "containment", "data"],
		["trace_out", "trace_source", "power"], ["quarantine_trace", "quarantine", "power"],
		["trace_data", "trace_source", "data"], ["containment_trace", "containment", "data"],
	]
	for definition in definitions:
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
	mission.game_state.alert_tier = 0 if preparation == "identity" else 1
	mission.game_state.topology = graph.snapshot()
	completed = false
	preview_command = null
	trace_progress = -1.0
	_recalculate_security()
	if is_instance_valid(player):
		player.position = NODE_POSITIONS.ingress + Vector3.UP * 0.85

func _build_environment() -> void:
	for id in NODE_ORDER:
		var pedestal := MeshInstance3D.new()
		pedestal.name = "Node_" + id
		var mesh := CylinderMesh.new()
		mesh.top_radius = 0.72
		mesh.bottom_radius = 0.9
		mesh.height = 0.45
		pedestal.mesh = mesh
		pedestal.position = NODE_POSITIONS[id]
		pedestal.material_override = _material(Color("562c72") if id == "trace_source" else Color("183c57"), Color("8a4fff") if id == "trace_source" else Color("1ac8c8"))
		nodes.add_child(pedestal)
		var ring := MeshInstance3D.new()
		var ring_mesh := TorusMesh.new()
		ring_mesh.inner_radius = 0.82
		ring_mesh.outer_radius = 0.9
		ring.mesh = ring_mesh
		ring.position = NODE_POSITIONS[id] + Vector3.UP * 0.28
		ring.material_override = _material(Color("55e7d2"), Color("55e7d2"))
		nodes.add_child(ring)
	for port_id in graph.ports:
		var marker := MeshInstance3D.new()
		marker.name = "Port_" + port_id
		var port_mesh := SphereMesh.new()
		port_mesh.radius = 0.16
		port_mesh.height = 0.32
		marker.mesh = port_mesh
		var type: String = graph.ports[port_id].type
		var color := Color("ffd166") if type == "power" else Color("ff6b9d") if type == "unstable" else Color("72f1d1")
		marker.material_override = _material(color, color)
		marker.position = NODE_POSITIONS[graph.ports[port_id].node] + _port_offset(port_id)
		ports.add_child(marker)

func _recalculate_security() -> void:
	patrol_route = graph.shortest_path("trace_source", mission.player_node)
	if patrol_route.size() < 2:
		patrol_route = graph.shortest_path("trace_source", "containment")
	patrol_index = mini(1, maxi(0, patrol_route.size() - 1))

func _move_patrol(delta: float) -> void:
	if patrol_route.size() < 2:
		return
	var target: Vector3 = NODE_POSITIONS[patrol_route[patrol_index]] + Vector3.UP * 0.7
	patrol.position = patrol.position.move_toward(target, delta * 1.4 * mission.security_speed())
	if patrol.position.distance_to(target) < 0.08:
		patrol_index += 1
		if patrol_index >= patrol_route.size():
			patrol_route.reverse()
			patrol_index = 1

func _update_trace_visual() -> void:
	if mission.trace_path.is_empty():
		return
	var scaled: float = trace_progress * float(mission.trace_path.size() - 1)
	var index := mini(int(scaled), mission.trace_path.size() - 1)
	var next_index := mini(index + 1, mission.trace_path.size() - 1)
	var local_t: float = scaled - floor(scaled)
	trace_pulse.position = NODE_POSITIONS[mission.trace_path[index]].lerp(NODE_POSITIONS[mission.trace_path[next_index]], local_t) + Vector3.UP

func _refresh_all() -> void:
	_refresh_links()
	_refresh_signals()
	_refresh_hud()

func _refresh_links() -> void:
	for child in links.get_children():
		child.queue_free()
	for connection in graph.connections:
		var a: Vector3 = NODE_POSITIONS[graph.ports[connection[0]].node] + Vector3.UP * 0.45
		var b: Vector3 = NODE_POSITIONS[graph.ports[connection[1]].node] + Vector3.UP * 0.45
		links.add_child(_beam(a, b, Color("65e7d1") if preview_command == null else Color("22f4ff"), 0.10))

func _refresh_signals() -> void:
	for child in signals.get_children():
		child.queue_free()
	for index in range(maxi(0, patrol_route.size() - 1)):
		var beam := _beam(NODE_POSITIONS[patrol_route[index]] + Vector3.UP * 0.65, NODE_POSITIONS[patrol_route[index + 1]] + Vector3.UP * 0.65, Color("ff496c"), 0.035)
		signals.add_child(beam)

func _refresh_hud() -> void:
	if not is_instance_valid(status_label):
		return
	status_label.text = message
	state_label.text = "ROUTE  %s     ALERT  %d — %s     ANCHOR  %s     EVIDENCE  %d/%d" % [
		mission.game_state.preparation.to_upper(),
		mission.game_state.alert_tier,
		ALERT_NAMES[mission.game_state.alert_tier],
		mission.checkpoint_node.to_upper(),
		mission.game_state.collected_memories.size(),
		mission.game_state.corrupted_memories.size(),
	]
	objective_label.text = "OBJECTIVE // %s" % ("Core mechanics loop complete" if completed else "Reach containment; detection alters the run without reloading")
	debug_label.visible = debug_overlay
	debug_label.text = "GRAPH DEBUG\nPlayer: %s\nPatrol: %s\nTrace: %s\nSignal speed: %.2fx\nEdit tolerance: %.0f%%\nActive links: %d" % [
		mission.player_node,
		" > ".join(patrol_route),
		" > ".join(mission.trace_path),
		mission.security_speed(),
		mission.edit_tolerance() * 100.0,
		graph.connections.size(),
	]

func _beam(start: Vector3, end: Vector3, color: Color, width: float) -> MeshInstance3D:
	var beam := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(width, width, start.distance_to(end))
	beam.mesh = mesh
	var midpoint := (start + end) * 0.5
	beam.position = midpoint
	beam.material_override = _material(color, color)
	beam.look_at_from_position(midpoint, end, Vector3.UP)
	return beam

func _port_offset(port_id: String) -> Vector3:
	var siblings: Array = graph.ports.keys().filter(func(key): return graph.ports[key].node == graph.ports[port_id].node)
	var angle := float(siblings.find(port_id)) * TAU / maxf(1.0, siblings.size())
	return Vector3(cos(angle), 0.7, sin(angle)) * 0.72

func _material(albedo: Color, emission: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = albedo
	material.emission_enabled = true
	material.emission = emission * 0.75
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material
