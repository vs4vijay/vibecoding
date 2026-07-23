class_name SaveService
extends RefCounted

const GameStateScript = preload("res://scripts/narrative/game_state.gd")
const DEFAULT_PATH := "user://continuity-error-save.json"

func save_game(state: RefCounted, path := DEFAULT_PATH) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(state.to_dict(), "\t"))
	return file.get_error() == OK

func load_game(state: RefCounted, path := DEFAULT_PATH) -> bool:
	if not FileAccess.file_exists(path):
		return false
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return false
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	return parsed is Dictionary and state.load_dict(parsed)
