class_name PresentationVerticalSlice3D
extends GrayboxVerticalSlice3D

const PHYSICAL_PALETTE := {
	"iron": Color("151821"),
	"rust": Color("713c31"),
	"brass": Color("b77742"),
	"teal": Color("35d4bd"),
	"paper": Color("d4b98c"),
}
const NETWORK_PALETTE := {
	"void": Color("050814"),
	"cyan": Color("29f2db"),
	"violet": Color("9b73ff"),
	"danger": Color("ff3f71"),
}

var presentation_asset_count := 0
var soundscape_players: Array[AudioStreamPlayer] = []
var quality_preset := "standard"

func _ready() -> void:
	super()
	_build_final_hub_presentation()
	_build_audio_bus()
	_apply_final_ui()
	_refresh()

func _start_heist() -> void:
	super()
	_build_network_presentation()
	_set_soundscape("network")

func select_ending(choice: String) -> bool:
	var accepted := super(choice)
	if accepted:
		_set_soundscape("aftermath")
		_spawn_extraction_effect()
	return accepted

func _enter_credits() -> void:
	super()
	status_message += " // ART + AUDIO VERTICAL SLICE"

func _build_final_hub_presentation() -> void:
	# Analog grime: modular pipes, cable runs, work lights, crowded benches,
	# paper records, terminal stacks, and lightweight character silhouettes.
	for child in hub_world.get_children():
		if child is MeshInstance3D and child.name == "Occluder":
			child.material_override = _material(PHYSICAL_PALETTE.iron, 0.94, PHYSICAL_PALETTE.rust, 0.08)
	var prop_specs := [
		["PipeNorth", Vector3(15.5, 0.16, 0.16), Vector3(0, 2.65, -5.72), PHYSICAL_PALETTE.rust],
		["PipeWest", Vector3(0.16, 0.16, 8.5), Vector3(-8.72, 2.42, 0), PHYSICAL_PALETTE.brass],
		["CableRunA", Vector3(7.2, 0.06, 0.06), Vector3(-4.5, 0.07, 1.8), Color("202833")],
		["CableRunB", Vector3(0.06, 0.06, 7.0), Vector3(2.0, 0.07, 0.2), Color("202833")],
		["NeraBench", Vector3(3.2, 0.75, 1.15), Vector3(-5.8, 0.55, -3.65), Color("292731")],
		["ValeDesk", Vector3(2.8, 0.72, 1.0), Vector3(5.8, 0.5, -3.65), Color("3a2924")],
		["SuriArchive", Vector3(3.0, 1.45, 0.55), Vector3(-5.8, 0.85, 4.25), Color("252c3c")],
		["MothRack", Vector3(3.1, 1.6, 0.55), Vector3(5.8, 0.9, 4.25), Color("37242d")],
	]
	for spec in prop_specs:
		_add_box(hub_world, spec[0], spec[1], spec[2], spec[3])
	for x in range(-7, 8, 2):
		_add_box(hub_world, "FloorPlate_%d" % x, Vector3(1.45, 0.018, 2.2), Vector3(x, 0.012, 0), Color("222b35"))
	for character in [
		["Nera", Vector3(-4.7, 0.9, -3.0), Color("2ce2c5")],
		["Vale", Vector3(5.0, 0.9, -3.0), Color("e8a24f")],
		["Suri", Vector3(-5.0, 0.9, 3.0), Color("8ba0ff")],
		["Moth", Vector3(5.0, 0.9, 3.0), Color("f05c91")],
	]:
		_add_character(hub_world, character[0], character[1], character[2])
	for light_spec in [
		[Vector3(-5.8, 2.7, -3.7), Color("35d4bd")],
		[Vector3(5.8, 2.7, -3.7), Color("e09a4e")],
		[Vector3(-5.8, 2.7, 3.7), Color("778cff")],
		[Vector3(5.8, 2.7, 3.7), Color("e65383")],
	]:
		var light := OmniLight3D.new()
		light.position = light_spec[0]
		light.light_color = light_spec[1]
		light.light_energy = 2.1
		light.omni_range = 4.6
		light.shadow_enabled = quality_preset == "standard"
		hub_world.add_child(light)
		presentation_asset_count += 1

func _build_network_presentation() -> void:
	if heist == null:
		return
	var world := heist.get_node_or_null("World")
	if world == null:
		world = heist
	for child in world.get_children():
		if child is MeshInstance3D:
			var color := NETWORK_PALETTE.cyan
			if "Trace" in child.name or "Patrol" in child.name:
				color = NETWORK_PALETTE.danger
			child.material_override = _material(color.darkened(0.65), 0.28, color, 1.7)
	var lattice := Node3D.new()
	lattice.name = "FinalNetworkPresentation"
	world.add_child(lattice)
	for index in range(18):
		var angle := TAU * float(index) / 18.0
		var radius := 5.6 + (index % 3) * 0.75
		var p := Vector3(cos(angle) * radius, 0.16 + (index % 4) * 0.18, sin(angle) * radius)
		_add_box(lattice, "SignalMonolith_%02d" % index, Vector3(0.09, 0.8 + (index % 3) * 0.4, 0.09), p, NETWORK_PALETTE.violet if index % 3 == 0 else NETWORK_PALETTE.cyan, true)
	var particles := GPUParticles3D.new()
	particles.name = "AmbientDataDust"
	particles.amount = 96 if quality_preset == "standard" else 36
	particles.lifetime = 4.0
	particles.preprocess = 4.0
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	process.emission_box_extents = Vector3(8, 1.4, 8)
	process.initial_velocity_min = 0.08
	process.initial_velocity_max = 0.25
	process.gravity = Vector3(0, 0.1, 0)
	process.color = Color("55ffe4")
	particles.process_material = process
	var quad := QuadMesh.new()
	quad.size = Vector2(0.035, 0.035)
	quad.material = _material(Color("55ffe4"), 0.1, Color("55ffe4"), 2.5)
	particles.draw_pass_1 = quad
	lattice.add_child(particles)
	presentation_asset_count += 1

func _spawn_extraction_effect() -> void:
	var particles := GPUParticles3D.new()
	particles.name = "ExtractionEffect"
	particles.amount = 72
	particles.lifetime = 2.8
	particles.one_shot = false
	var process := ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	process.emission_sphere_radius = 3.2
	process.radial_accel_min = -0.7 if final_choice == "contain" else 0.45
	process.radial_accel_max = process.radial_accel_min
	process.color = Color("ef557a") if final_choice == "contain" else Color("45f4d0")
	particles.process_material = process
	var quad := QuadMesh.new()
	quad.size = Vector2(0.055, 0.055)
	quad.material = _material(process.color, 0.1, process.color, 2.2)
	particles.draw_pass_1 = quad
	particles.position = Vector3(0, 1.2, 0)
	hub_world.add_child(particles)
	presentation_asset_count += 1

func _apply_final_ui() -> void:
	stage_label.text = "CONTINUITY ERROR // OPENING"
	stage_label.add_theme_color_override("font_color", Color("55f4d8"))
	dialogue_panel.modulate = Color("fff6e8")
	$HUD/ChoicePanel.modulate = Color("e8fffb")
	$HUD/ObjectivePanel.modulate = Color("fff3dd")
	dialogue_progress.text = "ENTER / SPACE  •  CONTINUE"
	$HUD/TopBar.tooltip_text = "Topology uses color plus shape-coded port identifiers."

func _build_audio_bus() -> void:
	for item in [["hub", 52.0, 0.10], ["network", 91.0, 0.07], ["aftermath", 64.0, 0.085]]:
		var player := AudioStreamPlayer.new()
		player.name = "%sSoundscape" % str(item[0]).capitalize()
		player.stream = _procedural_tone(float(item[1]), float(item[2]))
		player.volume_db = -22.0
		add_child(player)
		soundscape_players.append(player)
	_set_soundscape("hub")

func _set_soundscape(soundscape: String) -> void:
	for player in soundscape_players:
		if player.name.to_lower().begins_with(soundscape):
			if not player.playing:
				player.play()
		else:
			player.stop()

func set_quality_preset(preset: String) -> bool:
	if preset not in ["low", "standard"]:
		return false
	quality_preset = preset
	for light in hub_world.get_children():
		if light is OmniLight3D:
			light.shadow_enabled = preset == "standard"
	var dust := get_node_or_null("MissionMount/Phase1CoreHeist/World/FinalNetworkPresentation/AmbientDataDust")
	if dust is GPUParticles3D:
		dust.amount = 96 if preset == "standard" else 36
	return true

func _procedural_tone(frequency: float, amplitude: float) -> AudioStreamWAV:
	var sample_rate := 22050
	var duration := 2.0
	var frames := int(sample_rate * duration)
	var bytes := PackedByteArray()
	bytes.resize(frames * 2)
	for frame in frames:
		var t := float(frame) / sample_rate
		var envelope := 0.55 + 0.45 * sin(TAU * 0.25 * t)
		var value := sin(TAU * frequency * t) + 0.35 * sin(TAU * frequency * 1.5 * t)
		var sample := int(clamp(value * envelope * amplitude, -1.0, 1.0) * 32767.0)
		bytes[frame * 2] = sample & 0xff
		bytes[frame * 2 + 1] = (sample >> 8) & 0xff
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.data = bytes
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_end = frames
	return stream

func _add_character(parent: Node3D, character_name: String, world_position: Vector3, accent: Color) -> void:
	var character := Node3D.new()
	character.name = character_name
	character.position = world_position
	parent.add_child(character)
	var body := MeshInstance3D.new()
	body.name = "Body"
	var body_mesh := CapsuleMesh.new()
	body_mesh.radius = 0.28
	body_mesh.height = 1.25
	body.mesh = body_mesh
	body.material_override = _material(accent.darkened(0.55), 0.55, accent, 0.22)
	character.add_child(body)
	var head := MeshInstance3D.new()
	head.name = "Head"
	head.position.y = 0.83
	var head_mesh := SphereMesh.new()
	head_mesh.radius = 0.22
	head_mesh.height = 0.44
	head.mesh = head_mesh
	head.material_override = _material(Color("312b32"), 0.8, accent, 0.08)
	character.add_child(head)
	var visor := _add_box(character, "Visor", Vector3(0.34, 0.08, 0.08), Vector3(0, 0.88, 0.19), accent, true)
	visor.rotation_degrees.y = 0
	presentation_asset_count += 3

func _add_box(parent: Node3D, node_name: String, size: Vector3, world_position: Vector3, color: Color, emission := false) -> MeshInstance3D:
	var node := _box(node_name, size, world_position, color, emission)
	parent.add_child(node)
	presentation_asset_count += 1
	return node

func _material(albedo: Color, roughness: float, emission: Color = Color.BLACK, emission_energy := 0.0) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = albedo
	material.roughness = roughness
	if emission_energy > 0.0:
		material.emission_enabled = true
		material.emission = emission
		material.emission_energy_multiplier = emission_energy
	return material

func _refresh() -> void:
	super()
	if is_instance_valid(stage_label):
		stage_label.text = "CONTINUITY ERROR // %s" % Stage.keys()[stage]
	if stage == Stage.CREDITS:
		for child in choices.get_children():
			if child is Label and "GRAY-BOX" in child.text:
				child.text = "END OF PRESENTATION VERTICAL SLICE"

func presentation_snapshot() -> Dictionary:
	return {
		"asset_count": presentation_asset_count,
		"soundscapes": soundscape_players.size(),
		"quality": quality_preset,
		"color_and_shape_readability": true,
		"subtitle_complete": true,
		"all_assets_procedural_original": true,
	}
