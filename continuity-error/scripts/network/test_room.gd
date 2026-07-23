extends Node2D

const NetworkGraphScript = preload("res://scripts/network/network_graph.gd")
const NODE_RADIUS := 48.0
const PORT_RADIUS := 17.0
const PLAYER_SPEED := 240.0
const PATROL_SPEED := 105.0

var graph := NetworkGraphScript.new()
var node_order := ["ingress", "relay_a", "relay_b", "vault", "trace", "exit"]
var player_position := Vector2(250, 520)
var player_target := player_position
var patrol_position := Vector2.ZERO
var patrol_route: Array[String] = []
var patrol_route_index := 0
var edit_mode := false
var drag_port := ""
var hover_port := ""
var message := "Reach the EXIT. Hold E or middle mouse to edit topology."
var zoom_level := 1.0
var fps_samples: Array[float] = []

func _ready() -> void:
	_build_graph()
	patrol_position = graph.nodes["trace"]
	_recalculate_patrol()
	queue_redraw()

func _build_graph() -> void:
	var positions := {
		"ingress": Vector2(250, 520),
		"relay_a": Vector2(470, 390),
		"relay_b": Vector2(690, 520),
		"vault": Vector2(690, 250),
		"trace": Vector2(910, 390),
		"exit": Vector2(1100, 230),
	}
	for id in node_order:
		graph.add_node(id, positions[id])
	var definitions := [
		["ingress_out", "ingress", "data"], ["relay_a_in", "relay_a", "data"],
		["relay_a_out", "relay_a", "data"], ["vault_in", "vault", "data"],
		["vault_out", "vault", "data"], ["exit_in", "exit", "data"],
		["relay_b_in", "relay_b", "data"], ["relay_b_out", "relay_b", "data"],
		["trace_out", "trace", "data"], ["trace_alt", "trace", "power"],
		["exit_power", "exit", "power"], ["vault_power", "vault", "power"],
		["ingress_alt", "ingress", "data"],
	]
	for definition in definitions:
		graph.add_port(definition[0], definition[1], definition[2])
	graph.connect_ports("ingress_out", "relay_a_in")
	graph.connect_ports("relay_a_out", "vault_in")
	graph.connect_ports("vault_out", "exit_in")
	graph.connect_ports("trace_alt", "exit_power")
	graph.connect_ports("relay_b_out", "ingress_alt")

func _process(delta: float) -> void:
	var scaled_delta := delta * (0.15 if edit_mode else 1.0)
	_handle_keyboard(scaled_delta)
	player_position = player_position.move_toward(player_target, PLAYER_SPEED * scaled_delta)
	_move_patrol(scaled_delta)
	fps_samples.append(Engine.get_frames_per_second())
	if fps_samples.size() > 300:
		fps_samples.pop_front()
	queue_redraw()

func _handle_keyboard(delta: float) -> void:
	var direction := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if direction.length() > 0.01 and not edit_mode:
		player_position += direction.normalized() * PLAYER_SPEED * delta
		player_position.x = clampf(player_position.x, 80, 1200)
		player_position.y = clampf(player_position.y, 140, 650)
		player_target = player_position
	if Input.is_action_just_pressed("topology_edit"):
		edit_mode = true
	if Input.is_action_just_released("topology_edit"):
		edit_mode = false
		drag_port = ""
	if Input.is_action_just_pressed("cancel"):
		drag_port = ""
		message = "Edit cancelled; graph unchanged."
	if Input.is_action_just_pressed("camera_zoom_in"):
		zoom_level = minf(1.25, zoom_level + 0.1)
		$Camera2D.zoom = Vector2.ONE * zoom_level
	if Input.is_action_just_pressed("camera_zoom_out"):
		zoom_level = maxf(0.8, zoom_level - 0.1)
		$Camera2D.zoom = Vector2.ONE * zoom_level

func _unhandled_input(event: InputEvent) -> void:
	var pointer_position := Vector2.ZERO
	var pressed := false
	var released := false
	if event is InputEventMouse:
		pointer_position = event.position
		if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
			pressed = event.pressed
			released = not event.pressed
	elif event is InputEventScreenTouch:
		pointer_position = event.position
		pressed = event.pressed
		released = not event.pressed
		if pressed:
			edit_mode = _port_at(pointer_position) != ""
		else:
			edit_mode = false
	elif event is InputEventScreenDrag:
		pointer_position = event.position
	else:
		return
	hover_port = _port_at(pointer_position)
	if pressed:
		if edit_mode and hover_port != "":
			drag_port = hover_port
		elif not edit_mode:
			player_target = pointer_position
			message = "Moving to selected destination."
	if released and drag_port != "":
		_commit_drag(drag_port, hover_port)
		drag_port = ""

func _commit_drag(from_port: String, to_port: String) -> void:
	var validation := graph.connect_ports(from_port, to_port)
	message = validation.reason
	if validation.valid:
		message = "Connection committed. Patrol route recalculated."
		_recalculate_patrol()

func _port_at(position: Vector2) -> String:
	for id in graph.ports:
		if _port_position(id).distance_to(position) <= PORT_RADIUS * 1.8:
			return id
	return ""

func _port_position(id: String) -> Vector2:
	var port: Dictionary = graph.ports[id]
	var node_position: Vector2 = graph.nodes[port.node]
	var same_node: Array = graph.ports.keys().filter(func(key): return graph.ports[key].node == port.node)
	var offset_index := same_node.find(id)
	var angle := -0.5 + offset_index * 1.0
	return node_position + Vector2(cos(angle), sin(angle)) * (NODE_RADIUS + 18)

func _recalculate_patrol() -> void:
	patrol_route = graph.shortest_path("trace", "ingress")
	if patrol_route.is_empty():
		patrol_route = graph.shortest_path("trace", "exit")
	patrol_route_index = 1 if patrol_route.size() > 1 else 0

func _move_patrol(delta: float) -> void:
	if patrol_route.is_empty():
		return
	var target: Vector2 = graph.nodes[patrol_route[patrol_route_index]]
	patrol_position = patrol_position.move_toward(target, PATROL_SPEED * delta)
	if patrol_position.distance_to(target) < 2:
		patrol_route_index = (patrol_route_index + 1) % patrol_route.size()

func _draw() -> void:
	draw_string(ThemeDB.fallback_font, Vector2(32, 42), "CONTINUITY ERROR // PHASE 0", HORIZONTAL_ALIGNMENT_LEFT, -1, 24, Color("#77f7df"))
	draw_string(ThemeDB.fallback_font, Vector2(32, 72), message, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("#d4dcff"))
	draw_string(ThemeDB.fallback_font, Vector2(32, 100), "EDIT %s  |  TIME %.0f%%  |  FPS %d  |  ZOOM %.0f%%" % ["ON" if edit_mode else "OFF", 15 if edit_mode else 100, Engine.get_frames_per_second(), zoom_level * 100], HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("#91a0c4"))
	for connection in graph.connections:
		draw_line(_port_position(connection[0]), _port_position(connection[1]), Color("#3bd6b2"), 6)
	if drag_port != "":
		var mouse := get_viewport().get_mouse_position()
		var valid: bool = graph.validate_connection(drag_port, hover_port).valid if hover_port != "" else false
		draw_line(_port_position(drag_port), mouse, Color("#66ffb2") if valid else Color("#ff5577"), 4)
	for id in node_order:
		var position: Vector2 = graph.nodes[id]
		var diamond := PackedVector2Array([position + Vector2(0, -NODE_RADIUS), position + Vector2(NODE_RADIUS, 0), position + Vector2(0, NODE_RADIUS), position + Vector2(-NODE_RADIUS, 0)])
		draw_colored_polygon(diamond, Color("#182448"))
		draw_polyline(PackedVector2Array([diamond[0], diamond[1], diamond[2], diamond[3], diamond[0]]), Color("#526ca8"), 3)
		draw_string(ThemeDB.fallback_font, position + Vector2(-42, 6), id.to_upper(), HORIZONTAL_ALIGNMENT_CENTER, 84, 14, Color.WHITE)
	for id in graph.ports:
		var position := _port_position(id)
		var type: String = graph.ports[id].type
		var color := Color("#70e1ff") if type == "data" else Color("#ffd166")
		if id == hover_port:
			color = Color.WHITE
		draw_circle(position, PORT_RADIUS, color)
		if type == "power":
			draw_rect(Rect2(position - Vector2(7, 7), Vector2(14, 14)), Color("#182448"))
		else:
			draw_circle(position, 6, Color("#182448"))
	draw_circle(player_position, 18, Color("#f2f5ff"))
	draw_circle(player_position, 8, Color("#7a5cff"))
	draw_circle(patrol_position, 20, Color("#ff416c"))
	draw_arc(patrol_position, 28, 0, TAU, 24, Color("#ff9aae"), 3)
	draw_string(ThemeDB.fallback_font, Vector2(32, 690), "Mouse/touch: move or drag ports • WASD/arrows: move • Hold E: edit • Wheel: zoom • Esc: cancel", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color("#8d9ac0"))

func benchmark_result() -> Dictionary:
	var average := 0.0
	for sample in fps_samples:
		average += sample
	if not fps_samples.is_empty():
		average /= fps_samples.size()
	return {"average_fps": average, "sample_count": fps_samples.size(), "node_count": graph.nodes.size()}
