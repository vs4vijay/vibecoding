extends SceneTree

const NetworkGraphScript = preload("res://scripts/network/network_graph.gd")
var failures := 0

func _init() -> void:
	call_deferred("_run")

func check(condition: bool, description: String) -> void:
	if condition:
		print("PASS: ", description)
	else:
		failures += 1
		push_error("FAIL: " + description)

func _run() -> void:
	var graph := NetworkGraphScript.new()
	for item in [["a", Vector2.ZERO], ["b", Vector2.ONE], ["c", Vector2(2, 2)]]:
		graph.add_node(item[0], item[1])
	graph.add_port("a_data", "a", "data")
	graph.add_port("b_data", "b", "data")
	graph.add_port("b_power", "b", "power")
	graph.add_port("c_data", "c", "data")
	check(graph.connect_ports("a_data", "b_data").valid, "compatible typed ports connect")
	var snapshot := graph.snapshot()
	check(not graph.connect_ports("b_power", "c_data").valid, "incompatible ports are rejected")
	check(graph.connections == snapshot, "invalid edit preserves graph state")
	check(graph.shortest_path("a", "b") == ["a", "b"], "pathfinding follows active topology")
	check(graph.remove_connection("a_data", "b_data"), "connections can be removed")
	check(graph.shortest_path("a", "b").is_empty(), "path recalculates after topology change")
	graph.restore(snapshot)
	check(graph.shortest_path("a", "b") == ["a", "b"], "snapshot restores deterministic topology")
	var packed := load("res://scenes/test_room.tscn") as PackedScene
	var room := packed.instantiate()
	root.add_child(room)
	await process_frame
	check(room.graph.nodes.size() == 6, "gray-box contains six network nodes")
	check(room.patrol_route.size() > 0, "patrol has a graph-driven route")
	check(room.benchmark_result().node_count == 6, "benchmark exposes scene metrics")
	room.queue_free()
	await process_frame
	print("RESULT: %d passed, %d failed" % [10 - failures, failures])
	quit(1 if failures else 0)
