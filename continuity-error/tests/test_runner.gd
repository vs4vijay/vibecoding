extends SceneTree

const NetworkGraphScript = preload("res://scripts/network/network_graph.gd")
const RewireCommandScript = preload("res://scripts/network/rewire_command.gd")
const GameStateScript = preload("res://scripts/narrative/game_state.gd")
const MissionStateScript = preload("res://scripts/security/mission_state.gd")
const SaveServiceScript = preload("res://scripts/autoload/save_service.gd")

var failures := 0
var checks := 0

func _init() -> void:
	call_deferred("_run")

func check(condition: bool, description: String) -> void:
	checks += 1
	if condition:
		print("PASS: ", description)
	else:
		failures += 1
		push_error("FAIL: " + description)

func build_line_graph() -> NetworkGraph:
	var graph := NetworkGraphScript.new()
	for item in [["a", Vector2.ZERO], ["b", Vector2.ONE], ["c", Vector2(2, 2)], ["trace", Vector2(3, 3)]]:
		graph.add_node(item[0], item[1])
	for item in [
		["a_1", "a", "data"], ["a_2", "a", "data"], ["b_1", "b", "data"],
		["b_2", "b", "data"], ["c_1", "c", "data"], ["c_2", "c", "data"],
		["trace_1", "trace", "data"], ["b_power", "b", "power"],
	]:
		graph.add_port(item[0], item[1], item[2])
	graph.connect_ports("a_1", "b_1")
	graph.connect_ports("b_2", "c_1")
	graph.connect_ports("c_2", "trace_1")
	return graph

func _run() -> void:
	await _test_graph_and_rewire()
	await _test_corruption_and_security()
	await _test_serialization()
	await _test_two_route_heist()
	print("RESULT: %d passed, %d failed" % [checks - failures, failures])
	quit(1 if failures else 0)

func _test_graph_and_rewire() -> void:
	var graph := build_line_graph()
	check(graph.shortest_path("a", "trace") == ["a", "b", "c", "trace"], "deterministic path follows active topology")
	var snapshot := graph.snapshot()
	check(not graph.connect_ports("b_power", "a_2").valid, "incompatible typed ports are rejected")
	check(graph.connections == snapshot, "invalid edit preserves graph state")
	var command := RewireCommandScript.new(graph)
	check(command.preview(["b_2", "c_1"], ["a_2", "c_1"]).valid, "rewire preview validates replacement")
	check(graph.shortest_path("a", "c") == ["a", "c"], "preview exposes affected route")
	command.cancel()
	check(graph.snapshot() == snapshot, "cancel restores exact topology snapshot")
	check(command.preview(["b_2", "c_1"], ["a_2", "c_1"]).valid and command.commit(), "valid preview commits")
	check(graph.shortest_path("a", "c") == ["a", "c"], "committed edit changes route deterministically")
	var data := graph.to_dict()
	var restored := NetworkGraphScript.new()
	restored.load_dict(data)
	check(restored.to_dict() == data, "data-driven graph round-trips")

func _test_corruption_and_security() -> void:
	var graph := build_line_graph()
	var mission := MissionStateScript.new(graph)
	mission.player_node = "b"
	mission.activate_anchor("b")
	var before_anchor := graph.snapshot()
	check(mission.game_state.collect_memory("fragment_b"), "memory shard can be collected")
	check(mission.launch_trace("trace") == ["trace", "c", "b"], "trace pulse propagates through graph")
	var consequence: Dictionary = mission.complete_trace()
	check(consequence.consequence == "memory_corrupted" and consequence.memory == "fragment_b", "trace corrupts carried memory")
	check(mission.player_node == "b" and graph.snapshot() == before_anchor, "trace restores anchor and committed topology")
	mission.complete_trace()
	check("safe_corridor_2" in mission.game_state.closed_routes, "no-memory trace closes optional safe route")
	check(mission.game_state.alert_tier == 2, "alert escalation caps at tier two")
	check(mission.security_speed() == 1.7 and mission.edit_tolerance() == 0.45, "maximum alert changes both security speed and edit tolerance")
	check(mission.is_completable("trace"), "mission stays completable at maximum alert")

func _test_serialization() -> void:
	var state := GameStateScript.new()
	state.preparation = "backdoor"
	state.checkpoint = "stacks"
	state.alert_tier = 2
	state.collect_memory("asha_fragment")
	state.apply_trace()
	state.relationship_flags["trusted_asha"] = true
	state.topology = [["a_1", "b_1"]]
	var service := SaveServiceScript.new()
	var path := "user://phase1-test-save.json"
	check(service.save_game(state, path), "versioned game state saves as JSON")
	var loaded := GameStateScript.new()
	check(service.load_game(loaded, path), "versioned game state loads")
	check(loaded.to_dict() == state.to_dict(), "save/load reproduces preparation, topology, alert, memory, and branching state")
	var invalid := GameStateScript.new()
	check(not invalid.load_dict({"schema_version": 999}), "unknown save schema is rejected")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))

func _test_two_route_heist() -> void:
	var packed := load("res://scenes/heist_room.tscn") as PackedScene
	for route in ["identity", "backdoor"]:
		var room := packed.instantiate()
		root.add_child(room)
		await process_frame
		room._build_graph(route)
		room._advance()
		room._advance()
		room._collect_memory()
		room._advance()
		room._collect_memory()
		room.mission.game_state.alert_tier = 2
		check(room.state_snapshot().completable, "%s route remains completable at maximum alert" % route)
		room._advance()
		room._finish()
		var snapshot: Dictionary = room.state_snapshot()
		check(snapshot.completed and snapshot.player_node == "containment", "%s route completes mechanics-only heist" % route)
		check(snapshot.memories.size() == 2, "%s route exposes evidence inventory" % route)
		room.queue_free()
		await process_frame
