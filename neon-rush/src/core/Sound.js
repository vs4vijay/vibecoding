// No-op-safe SFX call sites. W1-AUDIO registers a provider here (or replaces
// this module); until then every sound(...) call is a silent no-op.
let provider = null;

export function setSoundProvider(p) { provider = p; }

export function sound(name, opts) {
  if (!provider) return;
  try { provider(name, opts); } catch (e) { /* audio must never break the game */ }
}
