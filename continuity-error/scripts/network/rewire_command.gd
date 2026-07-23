class_name RewireCommand
extends RefCounted

var graph: NetworkGraph
var removed_connection: Array[String] = []
var added_connection: Array[String] = []
var validation := {"valid": false, "reason": "Not previewed"}
var affected_nodes: Array[String] = []
var _before: Array[Array] = []
var _previewing := false

func _init(target_graph: NetworkGraph) -> void:
	graph = target_graph

func preview(remove: Array[String], add: Array[String]) -> Dictionary:
	cancel()
	_before = graph.snapshot()
	removed_connection = remove.duplicate()
	added_connection = add.duplicate()
	if remove.size() == 2 and not graph.remove_connection(remove[0], remove[1]):
		validation = {"valid": false, "reason": "Connection to remove is not active"}
		return validation
	if add.size() != 2:
		graph.restore(_before)
		validation = {"valid": false, "reason": "A connection needs two ports"}
		return validation
	validation = graph.connect_ports(add[0], add[1])
	if not validation.valid:
		graph.restore(_before)
		return validation
	affected_nodes.assign([
		graph.ports[add[0]].node,
		graph.ports[add[1]].node,
	])
	if remove.size() == 2:
		for port in remove:
			var node_id: String = graph.ports[port].node
			if node_id not in affected_nodes:
				affected_nodes.append(node_id)
	_previewing = true
	return validation

func commit() -> bool:
	if not _previewing or not validation.valid:
		return false
	_previewing = false
	_before.clear()
	return true

func cancel() -> void:
	if _previewing:
		graph.restore(_before)
	_previewing = false
	_before.clear()
