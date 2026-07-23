class_name NetworkGraph
extends RefCounted

const PORT_TYPES := {
	"data": ["data"],
	"power": ["power"],
	"unstable": ["data", "unstable"],
}

var nodes: Dictionary = {}
var ports: Dictionary = {}
var connections: Array[Array] = []

func add_node(id: String, position: Vector2) -> void:
	nodes[id] = position

func add_port(id: String, node_id: String, type: String) -> void:
	assert(nodes.has(node_id))
	ports[id] = {"node": node_id, "type": type}

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

func snapshot() -> Array[Array]:
	return connections.duplicate(true)

func restore(state: Array[Array]) -> void:
	connections = state.duplicate(true)
