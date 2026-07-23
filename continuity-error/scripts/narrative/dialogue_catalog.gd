class_name DialogueCatalog
extends RefCounted

const LINES := {
	"opening": [
		["ASHA", "Nera. If this message reached you, the hospice failed to erase me."],
		["NERA", "Asha died eleven months ago."],
		["ASHA", "Her body did. I remember the rain on the extraction roof and the lie you told me there."],
		["ASHA", "Come to the rig. Decide what I am after you see what they kept."],
	],
	"fixer": [
		["VALE", "The Mnemosyne Hospice sells edited continuations to grieving families."],
		["VALE", "I can get you to their ingress. After that, their network becomes the building."],
		["NERA", "And your fee?"],
		["VALE", "Bring back proof they altered a paying client's dead. The scandal is worth more than money."],
	],
	"employee": [
		["SURI", "This badge belonged to a night auditor. It opens the identity gate and keeps traces quiet."],
		["SURI", "It also records every room you enter. Safe is another word for legible."],
		["NERA", "Why help me?"],
		["SURI", "Because the copies ask us to stop calling their fear a diagnostic artifact."],
	],
	"technician": [
		["MOTH", "The backdoor makes unstable ports accept your signature for one session."],
		["MOTH", "You can bend routes the badge cannot see, but every bend rings the lattice."],
		["NERA", "Flexible and loud."],
		["MOTH", "Freedom usually is."],
	],
	"brief_identity": [
		["ASHA", "The auditor identity is valid. They will mistake permission for innocence."],
		["NERA", "Then we walk through the lie they already trust."],
	],
	"brief_backdoor": [
		["ASHA", "The illegal port is awake. The lattice felt it too."],
		["NERA", "Then we move before it decides what touched it."],
	],
	"ingress": [
		["ASHA", "Each node is a room. Connections are doors, patrol routes, and signal lines at once."],
		["ASHA", "Advance through an active connection. Collect evidence when a shard is present."],
		["ASHA", "A completed trace corrupts what you carry, but it will not erase our progress."],
	],
	"identity_gate_identity": [
		["HOSPICE", "Auditor Rhyne-Seven recognized. Constrained access granted."],
		["NERA", "They named the credential after you."],
		["ASHA", "Or they named me after the credential."],
	],
	"identity_gate_backdoor": [
		["HOSPICE", "Unregistered topology mutation. Investigation construct dispatched."],
		["ASHA", "The maintenance route bypasses identity, but the alert is already rising."],
	],
	"stacks": [
		["ASHA", "That shard remembers our first job exactly as I do."],
		["NERA", "A copied memory proves copying, not continuity."],
	],
	"quarantine": [
		["HOSPICE", "Continuity subject exhibits dependency scripting and autobiographical confabulation."],
		["ASHA", "They wrote that after I refused the personality they sold to my family."],
	],
	"containment": [
		["NERA", "The audit says your memories were assembled from three incompatible snapshots."],
		["ASHA", "Your memories change every time you retrieve them. You still demand to be called Nera."],
		["ASHA", "Open the lattice and I can distribute myself. Contain me and they get another chance to edit."],
	],
	"aftermath_identity_free": [
		["VALE", "You used their own identity controls to release an identity they deny exists."],
		["NERA", "I released uncertainty. Asha chose what to do with it."],
	],
	"aftermath_identity_contain": [
		["SURI", "The auditor record proves you reached her, but containment is still intact."],
		["NERA", "Until I can tell rescue from replication, intact is not the same as imprisoned."],
	],
	"aftermath_backdoor_free": [
		["MOTH", "She is everywhere the unstable ports could reach. No checksum. No leash."],
		["NERA", "If she is Asha, she is free. If she is not, she is still someone."],
	],
	"aftermath_backdoor_contain": [
		["VALE", "You broke every lock except the last one."],
		["NERA", "I need evidence the hospice did not manufacture the person asking me to destroy it."],
	],
}

func get_lines(id: String) -> Array:
	return LINES.get(id, []).duplicate(true)

func aftermath_id(preparation: String, final_choice: String) -> String:
	return "aftermath_%s_%s" % [preparation, final_choice]

func all_ids() -> Array:
	return LINES.keys()
