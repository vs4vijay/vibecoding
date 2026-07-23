class_name GameState
extends RefCounted

const SCHEMA_VERSION := 1

var current_scene := "heist"
var checkpoint := "ingress"
var preparation := "identity"
var alert_tier := 0
var collected_memories: Array[String] = []
var corrupted_memories: Array[String] = []
var closed_routes: Array[String] = []
var relationship_flags: Dictionary = {}
var final_choice := ""
var topology: Array[Array] = []

func collect_memory(id: String) -> bool:
	if id in collected_memories:
		return false
	collected_memories.append(id)
	return true

func apply_trace(preferred_memory := "") -> Dictionary:
	alert_tier = mini(2, alert_tier + 1)
	var candidates := collected_memories.filter(func(id): return id not in corrupted_memories)
	if not candidates.is_empty():
		candidates.sort()
		var selected: String = preferred_memory if preferred_memory in candidates else candidates[0]
		corrupted_memories.append(selected)
		return {"consequence": "memory_corrupted", "memory": selected}
	var route := "safe_corridor_%d" % alert_tier
	if route not in closed_routes:
		closed_routes.append(route)
	return {"consequence": "route_closed", "route": route}

func to_dict() -> Dictionary:
	return {
		"schema_version": SCHEMA_VERSION,
		"current_scene": current_scene,
		"checkpoint": checkpoint,
		"preparation": preparation,
		"alert_tier": alert_tier,
		"collected_memories": collected_memories,
		"corrupted_memories": corrupted_memories,
		"closed_routes": closed_routes,
		"relationship_flags": relationship_flags,
		"final_choice": final_choice,
		"topology": topology,
	}

func load_dict(data: Dictionary) -> bool:
	if int(data.get("schema_version", -1)) != SCHEMA_VERSION:
		return false
	current_scene = data.get("current_scene", "heist")
	checkpoint = data.get("checkpoint", "ingress")
	preparation = data.get("preparation", "identity")
	alert_tier = clampi(int(data.get("alert_tier", 0)), 0, 2)
	collected_memories.assign(data.get("collected_memories", []))
	corrupted_memories.assign(data.get("corrupted_memories", []))
	closed_routes.assign(data.get("closed_routes", []))
	relationship_flags = data.get("relationship_flags", {}).duplicate(true)
	final_choice = data.get("final_choice", "")
	topology.clear()
	for connection in data.get("topology", []):
		topology.append([str(connection[0]), str(connection[1])])
	return true
