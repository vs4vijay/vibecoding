class_name FeasibilitySlice
extends Node3D

const NODE_POSITIONS := {
	"A": Vector3(-7.0, 0.35, 3.5),
	"B": Vector3(-3.5, 0.35, 0.0),
	"C": Vector3(0.0, 1.35, -3.5),
	"D": Vector3(3.5, 0.35, 0.0),
	"E": Vector3(7.0, 0.35, 3.5),
	"F": Vector3(0.0, 0.35, 4.5),
}
const DEFAULT_EDGES := [["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"]]
const REROUTED_EDGES := [["A", "B"], ["B", "F"], ["F", "E"]]

var active_edges: Array = DEFAULT_EDGES.duplicate(true)
var edit_mode := false
var selected_port := ""
var patrol_route: Array[String] = ["A", "B", "C", "D", "E"]
var patrol_index := 1
var patrol_speed := 2.2
var zoom := 12.5
var benchmark_started_ms := 0
var benchmark_frames := 0
var movement_target := Vector3.ZERO
var has_movement_target := false

@onready var player: CharacterBody3D = $Player
@onready var patrol: CharacterBody3D = $Patrol
@onready var camera: Camera3D = $CameraRig/Camera3D
@onready var navigation_agent: NavigationAgent3D = $Player/NavigationAgent3D
@onready var status_label: Label = $HUD/Panel/Margin/VBox/Status
@onready var metrics_label: Label = $HUD/Panel/Margin/VBox/Metrics
@onready var edit_overlay: ColorRect = $EditOverlay

func _ready() -> void:
	_build_room()
	_configure_navigation()
	_refresh_visuals()
	benchmark_started_ms = Time.get_ticks_msec()
	status_label.text = "Explore with WASD or click the floor. Hold E to edit topology."

func _physics_process(delta: float) -> void:
	benchmark_frames += 1
	var input := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if input.length() > 0.05:
		has_movement_target = false
		var direction := Vector3(input.x, 0.0, input.y).normalized()
		player.velocity = direction * 4.4
		player.move_and_slide()
	elif has_movement_target:
		var next := navigation_agent.get_next_path_position()
		var direction := player.global_position.direction_to(next)
		direction.y = 0.0
		player.velocity = direction.normalized() * 4.4
		player.move_and_slide()
		if player.global_position.distance_to(movement_target) < 0.25:
			has_movement_target = false
			player.velocity = Vector3.ZERO
	else:
		player.velocity = Vector3.ZERO
	_move_patrol(delta)
	if Time.get_ticks_msec() - benchmark_started_ms > 1000:
		var fps := benchmark_frames * 1000.0 / maxf(1.0, Time.get_ticks_msec() - benchmark_started_ms)
		metrics_label.text = "FPS %.0f  |  6 graph nodes  |  %d active links  |  Compatibility renderer" % [fps, active_edges.size()]
		benchmark_frames = 0
		benchmark_started_ms = Time.get_ticks_msec()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("topology_edit"):
		set_edit_mode(true)
	elif event.is_action_released("topology_edit"):
		set_edit_mode(false)
	elif event.is_action_pressed("camera_zoom_in"):
		zoom = maxf(8.0, zoom - 1.0)
		camera.size = zoom
	elif event.is_action_pressed("camera_zoom_out"):
		zoom = minf(18.0, zoom + 1.0)
		camera.size = zoom
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		_pick_world(event.position)

func set_edit_mode(enabled: bool) -> void:
	edit_mode = enabled
	Engine.time_scale = 0.22 if enabled else 1.0
	edit_overlay.visible = enabled
	if not enabled:
		selected_port = ""
	status_label.text = "EDIT MODE — select B then F to redirect patrol" if enabled else "Topology locked. Hold E to edit again."
	_refresh_visuals()

func try_rewire(from_node: String, to_node: String) -> Dictionary:
	if from_node == to_node or not NODE_POSITIONS.has(from_node) or not NODE_POSITIONS.has(to_node):
		return {"valid": false, "reason": "Choose two different known ports"}
	if [from_node, to_node] != ["B", "F"] and [from_node, to_node] != ["F", "B"]:
		return {"valid": false, "reason": "Incompatible port shapes — state unchanged"}
	active_edges = REROUTED_EDGES.duplicate(true)
	patrol_route.assign(["A", "B", "F", "E"])
	patrol_index = mini(patrol_index, patrol_route.size() - 1)
	_refresh_visuals()
	return {"valid": true, "reason": "Patrol redirected through node F"}

func graph_snapshot() -> Array:
	return active_edges.duplicate(true)

func _pick_world(screen_position: Vector2) -> void:
	var origin := camera.project_ray_origin(screen_position)
	var query := PhysicsRayQueryParameters3D.create(origin, origin + camera.project_ray_normal(screen_position) * 100.0)
	query.collide_with_areas = true
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return
	var collider: Object = hit.collider
	if edit_mode and collider is Area3D and collider.has_meta("port_id"):
		var port_id := str(collider.get_meta("port_id"))
		if selected_port.is_empty():
			selected_port = port_id
			status_label.text = "%s selected — choose a compatible diamond port" % port_id
		else:
			var result := try_rewire(selected_port, port_id)
			status_label.text = result.reason
			selected_port = ""
	elif collider is StaticBody3D:
		movement_target = hit.position
		movement_target.y = player.global_position.y
		navigation_agent.target_position = movement_target
		has_movement_target = true

func _move_patrol(delta: float) -> void:
	if patrol_route.is_empty():
		return
	var target: Vector3 = NODE_POSITIONS[patrol_route[patrol_index]] + Vector3.UP * 0.55
	patrol.global_position = patrol.global_position.move_toward(target, patrol_speed * delta)
	if patrol.global_position.distance_to(target) < 0.08:
		patrol_index += 1
		if patrol_index >= patrol_route.size():
			patrol_route.reverse()
			patrol_index = 1

func _build_room() -> void:
	for id in NODE_POSITIONS:
		var marker := MeshInstance3D.new()
		marker.name = "Node_" + id
		var mesh := CylinderMesh.new()
		mesh.top_radius = 0.7
		mesh.bottom_radius = 0.85
		mesh.height = 0.35
		marker.mesh = mesh
		marker.position = NODE_POSITIONS[id]
		$GraphVisuals.add_child(marker)
		var area := Area3D.new()
		area.name = "Port_" + id
		area.set_meta("port_id", id)
		area.position = NODE_POSITIONS[id] + Vector3.UP * 0.7
		var shape := CollisionShape3D.new()
		var sphere := SphereShape3D.new()
		sphere.radius = 0.55
		shape.shape = sphere
		area.add_child(shape)
		var visual := MeshInstance3D.new()
		var port_mesh := SphereMesh.new()
		port_mesh.radius = 0.28
		port_mesh.height = 0.56
		visual.mesh = port_mesh
		area.add_child(visual)
		$Ports.add_child(area)

func _configure_navigation() -> void:
	var nav_mesh := NavigationMesh.new()
	nav_mesh.vertices = PackedVector3Array([
		Vector3(-9.5, 0.2, -6.0), Vector3(9.5, 0.2, -6.0),
		Vector3(9.5, 0.2, 7.0), Vector3(-9.5, 0.2, 7.0),
	])
	nav_mesh.add_polygon(PackedInt32Array([0, 1, 2, 3]))
	$NavigationRegion3D.navigation_mesh = nav_mesh

func _refresh_visuals() -> void:
	for child in $Connections.get_children():
		child.queue_free()
	for edge in active_edges:
		var start: Vector3 = NODE_POSITIONS[edge[0]] + Vector3.UP * 0.25
		var end: Vector3 = NODE_POSITIONS[edge[1]] + Vector3.UP * 0.25
		var link := MeshInstance3D.new()
		var mesh := BoxMesh.new()
		mesh.size = Vector3(0.12, 0.12, start.distance_to(end))
		link.mesh = mesh
		link.position = (start + end) * 0.5
		link.material_override = _material(Color("35e7d2"))
		$Connections.add_child(link)
		link.look_at(end, Vector3.UP)
	for area in $Ports.get_children():
		var id := str(area.get_meta("port_id"))
		var visual := area.get_child(1) as MeshInstance3D
		visual.material_override = _material(Color("ffd166") if edit_mode else Color("457b9d"))
		visual.scale = Vector3.ONE * (1.35 if selected_port == id else 1.0)

func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.emission_enabled = true
	material.emission = color * 0.65
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material
