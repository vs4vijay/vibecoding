class_name NetworkGraph
extends Resource

const PORT_TYPES := {
	"data": ["data"],
	"power": ["power"],
	"unstable": ["data", "unstable"],
}

var nodes: Dictionary = {}
var ports: Dictionary = {}
var connections: Array[Array] = []
var required_nodes: Array[String] = []

func add_node(id: String, position: Vector2, metadata: Dictionary = {}) -> void:
	nodes[id] = {"position": position, "metadata": metadata.duplicate(true)}

func add_port(id: String, node_id: String, type: String, metadata: Dictionary = {}) -> void:
	assert(nodes.has(node_id))
	ports[id] = {"node": node_id, "type": type, "metadata": metadata.duplicate(true)}

func node_position(id: String) -> Vector2:
	var node: Variant = nodes.get(id)
	if node is Vector2:
		return node
	return node.get("position", Vector2.ZERO)

func connect_ports(a: String, b: String) -> Dictionary:
	var validation := validate_connection(a, b)
	if not validation.valid:
		return validation
	connections.append([a, b])
	return validation

func validate_connection(a: String, b: String) -> Dictionary:
	if not ports.has(a) or not ports.has(b):
		return {"valid": false, "reason": "Unknown port"}
	if a == b:
		return {"valid": false, "reason": "Choose a different port"}
	if ports[a].node == ports[b].node:
		return {"valid": false, "reason": "Ports on the same node cannot connect"}
	if is_port_connected(a) or is_port_connected(b):
		return {"valid": false, "reason": "A port already has an active connection"}
	if not PORT_TYPES.get(ports[a].type, []).has(ports[b].type):
		return {"valid": false, "reason": "Port types are incompatible"}
	var state := snapshot()
	connections.append([a, b])
	var reachable := required_nodes.is_empty() or _required_nodes_reachable()
	restore(state)
	if not reachable:
		return {"valid": false, "reason": "Edit would isolate a required route"}
	return {"valid": true, "reason": "Valid connection"}

func is_port_connected(port_id: String) -> bool:
	for connection in connections:
		if port_id in connection:
			return true
	return false

func remove_connection(a: String, b: String) -> bool:
	for index in connections.size():
		var connection := connections[index]
		if (connection[0] == a and connection[1] == b) or (connection[0] == b and connection[1] == a):
			connections.remove_at(index)
			return true
	return false

func connected_nodes(node_id: String) -> Array[String]:
	var result: Array[String] = []
	for connection in connections:
		var first: Dictionary = ports[connection[0]]
		var second: Dictionary = ports[connection[1]]
		if first.node == node_id:
			result.append(second.node)
		elif second.node == node_id:
			result.append(first.node)
	return result

func shortest_path(start: String, goal: String) -> Array[String]:
	if not nodes.has(start) or not nodes.has(goal):
		return []
	var queue: Array[String] = [start]
	var parent := {start: ""}
	while not queue.is_empty():
		var current: String = queue.pop_front()
		if current == goal:
			var path: Array[String] = []
			while current != "":
				path.push_front(current)
				current = str(parent[current])
			return path
		for neighbor in connected_nodes(current):
			if not parent.has(neighbor):
				parent[neighbor] = current
				queue.append(neighbor)
	return []

func reachable_from(start: String) -> Array[String]:
	if not nodes.has(start):
		return []
	var result: Array[String] = []
	var queue: Array[String] = [start]
	while not queue.is_empty():
		var current: String = queue.pop_front()
		if current in result:
			continue
		result.append(current)
		var neighbors := connected_nodes(current)
		neighbors.sort()
		queue.append_array(neighbors)
	return result

func _required_nodes_reachable() -> bool:
	if required_nodes.size() < 2:
		return true
	var reachable := reachable_from(required_nodes[0])
	return required_nodes.all(func(id): return id in reachable)

func snapshot() -> Array[Array]:
	return connections.duplicate(true)

func restore(state: Array[Array]) -> void:
	connections = state.duplicate(true)

func to_dict() -> Dictionary:
	var serialized_nodes := {}
	for id in nodes:
		var metadata: Dictionary = {}
		if nodes[id] is Dictionary:
			metadata = nodes[id].get("metadata", {})
		var position := node_position(id)
		serialized_nodes[id] = {"position": [position.x, position.y], "metadata": metadata}
	return {
		"nodes": serialized_nodes,
		"ports": ports.duplicate(true),
		"connections": connections.duplicate(true),
		"required_nodes": required_nodes.duplicate(),
	}

func load_dict(data: Dictionary) -> void:
	nodes.clear()
	ports = data.get("ports", {}).duplicate(true)
	connections.clear()
	required_nodes.assign(data.get("required_nodes", []))
	for id in data.get("nodes", {}):
		var node: Dictionary = data.nodes[id]
		var position: Array = node.get("position", [0.0, 0.0])
		add_node(id, Vector2(position[0], position[1]), node.get("metadata", {}))
	for connection in data.get("connections", []):
		connections.append([str(connection[0]), str(connection[1])])
