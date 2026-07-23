class_name MissionState
extends RefCounted

const GameStateScript = preload("res://scripts/narrative/game_state.gd")
const ALERT_SPEEDS := [1.0, 1.35, 1.7]
const EDIT_TOLERANCE := [1.0, 0.7, 0.45]

var game_state = GameStateScript.new()
var graph: NetworkGraph
var player_node := "ingress"
var checkpoint_graph: Array[Array] = []
var checkpoint_node := "ingress"
var trace_path: Array[String] = []

func _init(target_graph: NetworkGraph) -> void:
	graph = target_graph
	checkpoint_graph = graph.snapshot()

func can_travel(destination: String) -> bool:
	return destination in graph.connected_nodes(player_node)

func travel(destination: String) -> bool:
	if not can_travel(destination):
		return false
	player_node = destination
	return true

func activate_anchor(node_id: String) -> bool:
	if player_node != node_id:
		return false
	checkpoint_node = node_id
	checkpoint_graph = graph.snapshot()
	game_state.checkpoint = node_id
	return true

func launch_trace(source: String) -> Array[String]:
	trace_path = graph.shortest_path(source, player_node)
	return trace_path

func complete_trace(preferred_memory := "") -> Dictionary:
	var result := game_state.apply_trace(preferred_memory)
	player_node = checkpoint_node
	graph.restore(checkpoint_graph)
	trace_path.clear()
	return result

func is_completable(goal := "containment") -> bool:
	return not graph.shortest_path(player_node, goal).is_empty()

func security_speed() -> float:
	return ALERT_SPEEDS[game_state.alert_tier]

func edit_tolerance() -> float:
	return EDIT_TOLERANCE[game_state.alert_tier]
