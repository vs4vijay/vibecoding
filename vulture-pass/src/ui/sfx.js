// UI-side sfx hook. The game wires this to the audio manager at boot so UI
// modules never import the engine directly (keeps ui/ → engine boundary one-way).

let handler = null;

export function setSfxHandler(fn) {
  handler = fn;
}

export function sfxUi(name) {
  handler?.(name);
}
