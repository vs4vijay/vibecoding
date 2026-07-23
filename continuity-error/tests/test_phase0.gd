extends Node

const SliceScene = preload("res://scenes/phase0_feasibility.tscn")

func test_phase0_six_node_graph_and_valid_rewire() -> void:
	var slice = SliceScene.instantiate()
	add_child(slice)
	assert(slice.NODE_POSITIONS.size() == 6)
	var before: Array = slice.graph_snapshot()
	var result: Dictionary = slice.try_rewire("B", "F")
	assert(result.valid)
	assert(slice.graph_snapshot() != before)
	assert(slice.patrol_route == ["A", "B", "F", "E"])
	slice.queue_free()

func test_phase0_invalid_rewire_preserves_state() -> void:
	var slice = SliceScene.instantiate()
	add_child(slice)
	var before: Array = slice.graph_snapshot()
	var result: Dictionary = slice.try_rewire("A", "E")
	assert(not result.valid)
	assert(slice.graph_snapshot() == before)
	slice.queue_free()

func test_phase0_edit_mode_slows_and_restores_time() -> void:
	var slice = SliceScene.instantiate()
	add_child(slice)
	slice.set_edit_mode(true)
	assert(is_equal_approx(Engine.time_scale, 0.22))
	slice.set_edit_mode(false)
	assert(is_equal_approx(Engine.time_scale, 1.0))
	slice.queue_free()
