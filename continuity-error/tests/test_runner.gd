extends SceneTree

const NetworkGraphScript = preload("res://scripts/network/network_graph.gd")
const RewireCommandScript = preload("res://scripts/network/rewire_command.gd")
const GameStateScript = preload("res://scripts/narrative/game_state.gd")
const MissionStateScript = preload("res://scripts/security/mission_state.gd")
const SaveServiceScript = preload("res://scripts/autoload/save_service.gd")
const DialogueCatalogScript = preload("res://scripts/narrative/dialogue_catalog.gd")
const VerticalSliceScene = preload("res://scenes/vertical_slice.tscn")
const Phase0Scene = preload("res://scenes/phase0_feasibility.tscn")
const Phase1Scene = preload("res://scenes/phase1_core_heist.tscn")
const Phase2Scene = preload("res://scenes/phase2_graybox_vertical_slice.tscn")
const Phase3Scene = preload("res://scenes/phase3_presentation_vertical_slice.tscn")

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
	await _test_phase0_feasibility()
	await _test_phase1_3d_heist()
	await _test_graph_and_rewire()
	await _test_corruption_and_security()
	await _test_serialization()
	await _test_two_route_heist()
	await _test_phase_2_vertical_slice()
	await _test_phase_2_3d_vertical_slice()
	await _test_phase_3_presentation_slice()
	await process_frame
	print("RESULT: %d passed, %d failed" % [checks - failures, failures])
	quit(1 if failures else 0)

func _test_phase0_feasibility() -> void:
	var slice := Phase0Scene.instantiate()
	root.add_child(slice)
	await process_frame
	check(slice.NODE_POSITIONS.size() == 6, "Phase 0 graph exposes exactly six authored nodes")
	var before: Array = slice.graph_snapshot()
	var rejected: Dictionary = slice.try_rewire("A", "E")
	check(not rejected.valid and slice.graph_snapshot() == before, "Phase 0 invalid edit preserves graph state")
	slice.set_edit_mode(true)
	check(is_equal_approx(Engine.time_scale, 0.22), "Phase 0 edit mode slows simulation")
	slice.set_edit_mode(false)
	check(is_equal_approx(Engine.time_scale, 1.0), "Phase 0 leaving edit mode restores simulation speed")
	var accepted: Dictionary = slice.try_rewire("B", "F")
	check(accepted.valid and slice.patrol_route == ["A", "B", "F", "E"], "Phase 0 valid edit visibly reroutes patrol")
	slice.queue_free()
	await process_frame

func _test_phase1_3d_heist() -> void:
	for route in ["identity", "backdoor"]:
		var heist := Phase1Scene.instantiate()
		root.add_child(heist)
		await process_frame
		check(heist is Node3D and heist.NODE_POSITIONS.size() == 7, "Phase 1 %s route runs as authored 3D graph" % route)
		check(heist.select_preparation(route), "Phase 1 selects %s preparation" % route)
		check(heist.mission.game_state.alert_tier == (0 if route == "identity" else 1), "%s route applies deterministic starting risk" % route)
		check(heist.invalid_edit_preserves_state(), "Phase 1 invalid edit preserves exact graph state")
		var topology_before: Array = heist.graph.snapshot()
		check(heist.preview_or_commit_rewire(), "Phase 1 exposes a valid topology preview")
		check(heist.cancel_rewire() and heist.graph.snapshot() == topology_before, "Phase 1 cancel restores exact topology")
		check(heist.preview_or_commit_rewire() and heist.preview_or_commit_rewire(), "Phase 1 valid edit previews and commits")
		check(heist.advance() and heist.advance(), "%s route reaches first network anchor" % route)
		check(heist.collect_memory(), "%s route collects spatial memory shard" % route)
		var consequence: Dictionary = heist.resolve_trace_immediately()
		check(consequence.consequence == "memory_corrupted", "%s detection corrupts evidence without reload" % route)
		heist.resolve_trace_immediately()
		check(heist.mission.game_state.alert_tier == 2, "%s route reaches maximum alert" % route)
		check(heist.state_snapshot().completable, "%s route remains completable at maximum alert" % route)
		var path := "user://phase1-3d-%s.json" % route
		check(heist.save_game(path), "%s route saves 3D mission state" % route)
		var saved_snapshot: Dictionary = heist.state_snapshot()
		heist.select_preparation("identity" if route == "backdoor" else "backdoor")
		check(heist.load_game(path), "%s route reloads 3D mission state" % route)
		var loaded_snapshot: Dictionary = heist.state_snapshot()
		check(loaded_snapshot.preparation == saved_snapshot.preparation and loaded_snapshot.alert_tier == saved_snapshot.alert_tier and loaded_snapshot.topology == saved_snapshot.topology and loaded_snapshot.corrupted == saved_snapshot.corrupted, "%s save/load reproduces route, alert, topology, and memory" % route)
		var progressed: bool = heist.advance()
		if not heist.state_snapshot().completed:
			progressed = progressed and heist.advance()
		check(progressed, "%s route completes from maximum alert" % route)
		check(heist.state_snapshot().completed, "%s route reaches containment" % route)
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
		heist.queue_free()
		await process_frame

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

func _drain_dialogue(slice: Node) -> void:
	while not slice.dialogue.is_empty():
		slice.advance_dialogue()

func _test_phase_2_vertical_slice() -> void:
	var catalog := DialogueCatalogScript.new()
	check(catalog.all_ids().size() >= 16, "complete subtitle draft covers opening, contacts, zones, and aftermaths")
	for route in ["identity", "backdoor"]:
		for ending in ["free", "contain"]:
			var slice := VerticalSliceScene.instantiate()
			root.add_child(slice)
			await process_frame
			_drain_dialogue(slice)
			check(slice.stage == slice.Stage.HUB, "%s/%s reaches gray-box hub from opening" % [route, ending])
			for contact in range(3):
				check(slice.visit_contact(contact), "contact %d is functional" % contact)
				_drain_dialogue(slice)
			check(slice.contacts_seen.size() == 3 and slice.begin_preparation(), "all contacts unlock preparation")
			check(slice.select_preparation(route), "%s preparation can be selected" % route)
			_drain_dialogue(slice)
			_drain_dialogue(slice)
			check(slice.stage == slice.Stage.HEIST, "%s enters hospice ingress" % route)
			check(not slice.heist.is_processing_unhandled_input(), "embedded heist cannot double-handle slice input")
			check(slice.heist.mission.game_state.alert_tier == (0 if route == "identity" else 1), "%s materially changes starting hazard" % route)
			for step in range(4):
				check(slice.advance_heist(), "%s advances through hospice zone %d" % [route, step + 2])
				_drain_dialogue(slice)
				if slice.stage == slice.Stage.HEIST and slice.heist.mission.player_node in ["stacks", "quarantine"]:
					check(slice.collect_evidence(), "%s collects evidence in %s" % [route, slice.heist.mission.player_node])
			check(slice.stage == slice.Stage.EXTRACTION, "%s reaches extraction without intervention" % route)
			check(slice.select_ending(ending), "%s ending can be selected" % ending)
			_drain_dialogue(slice)
			var state: Dictionary = slice.snapshot()
			check(state.stage == slice.Stage.CREDITS and state.final_choice == ending, "%s/%s reaches distinct credits state" % [route, ending])
			check(state.memories.size() == 2, "%s/%s carries supporting and undermining evidence" % [route, ending])
			slice.queue_free()
			await process_frame

func _test_phase_2_3d_vertical_slice() -> void:
	var catalog := DialogueCatalogScript.new()
	check(catalog.all_ids().size() >= 16, "Phase 2 subtitle catalog covers all authored beats")
	for route in ["identity", "backdoor"]:
		for ending in ["free", "contain"]:
			var slice := Phase2Scene.instantiate()
			root.add_child(slice)
			await process_frame
			check(slice is Node3D and slice.snapshot().is_3d, "Phase 2 %s/%s is a true 3D slice" % [route, ending])
			check(slice.get_node("HubWorld").get_child_count() >= 10, "Phase 2 hub provides authored rooms, occluders, and contact stations")
			_drain_dialogue(slice)
			check(slice.stage == slice.Stage.HUB, "Phase 2 opening flows into the 3D hub")
			check(not slice.begin_preparation(), "Phase 2 preparation stays locked until all contacts are met")
			for contact in range(3):
				check(slice.visit_contact(contact), "Phase 2 contact %d is functional" % contact)
				_drain_dialogue(slice)
			check(slice.begin_preparation(), "Phase 2 all contacts unlock preparation")
			check(slice.select_preparation(route), "Phase 2 selects %s preparation" % route)
			_drain_dialogue(slice)
			_drain_dialogue(slice)
			check(slice.stage == slice.Stage.HEIST, "Phase 2 %s route enters 3D hospice" % route)
			check(slice.heist is Node3D and not slice.heist.is_processing_unhandled_input(), "Phase 2 embeds the 3D heist without duplicate input")
			check(slice.heist.mission.game_state.alert_tier == (0 if route == "identity" else 1), "Phase 2 %s route materially changes starting hazard" % route)
			for step in range(4):
				check(slice.advance_heist(), "Phase 2 %s advances authored zone %d/5" % [route, step + 2])
				_drain_dialogue(slice)
				if slice.stage == slice.Stage.HEIST and slice.heist.mission.player_node in ["stacks", "quarantine"]:
					check(slice.collect_evidence(), "Phase 2 collects evidence at %s" % slice.heist.mission.player_node)
			check(slice.stage == slice.Stage.EXTRACTION, "Phase 2 %s reaches Asha containment" % route)
			check(slice.select_ending(ending), "Phase 2 supports %s ending" % ending)
			_drain_dialogue(slice)
			var state: Dictionary = slice.snapshot()
			check(state.stage == slice.Stage.CREDITS and state.final_choice == ending, "Phase 2 %s/%s reaches distinct credits" % [route, ending])
			check(state.memories.size() == 2, "Phase 2 %s/%s preserves supporting and undermining evidence" % [route, ending])
			check(slice.get_node("HubWorld").get_node_or_null("AftermathSignal") != null, "Phase 2 aftermath visibly reflects final choice")
			slice.queue_free()
			await process_frame

func _test_phase_3_presentation_slice() -> void:
	for route in ["identity", "backdoor"]:
		for ending in ["free", "contain"]:
			var slice := Phase3Scene.instantiate()
			root.add_child(slice)
			await process_frame
			var presentation: Dictionary = slice.presentation_snapshot()
			check(presentation.asset_count >= 35, "Phase 3 hub replaces gray-box presentation with authored modular detail")
			check(presentation.soundscapes == 3, "Phase 3 includes hub, network, and aftermath soundscapes")
			check(presentation.color_and_shape_readability and presentation.subtitle_complete, "Phase 3 remains readable without color or voice")
			check(presentation.all_assets_procedural_original, "Phase 3 shipped presentation has documented original provenance")
			check(slice.set_quality_preset("low") and slice.presentation_snapshot().quality == "low", "Phase 3 low quality preset is available")
			check(slice.set_quality_preset("standard"), "Phase 3 standard quality preset is available")
			_drain_dialogue(slice)
			for contact in range(3):
				check(slice.visit_contact(contact), "Phase 3 contact %d remains functional" % contact)
				_drain_dialogue(slice)
			check(slice.begin_preparation() and slice.select_preparation(route), "Phase 3 selects %s preparation" % route)
			_drain_dialogue(slice)
			_drain_dialogue(slice)
			check(slice.get_node("MissionMount").get_child_count() == 1, "Phase 3 mounts the styled cyberspace mission")
			for step in range(4):
				check(slice.advance_heist(), "Phase 3 %s advances zone %d/5" % [route, step + 2])
				_drain_dialogue(slice)
				if slice.stage == slice.Stage.HEIST and slice.heist.mission.player_node in ["stacks", "quarantine"]:
					check(slice.collect_evidence(), "Phase 3 collects evidence at %s" % slice.heist.mission.player_node)
			check(slice.select_ending(ending), "Phase 3 supports %s ending" % ending)
			_drain_dialogue(slice)
			var state: Dictionary = slice.snapshot()
			check(state.stage == slice.Stage.CREDITS and state.memories.size() == 2, "Phase 3 %s/%s reaches final credits with evidence" % [route, ending])
			check(slice.get_node("HubWorld").get_node_or_null("ExtractionEffect") != null, "Phase 3 ending has a choice-reactive extraction effect")
			slice.queue_free()
			await process_frame
