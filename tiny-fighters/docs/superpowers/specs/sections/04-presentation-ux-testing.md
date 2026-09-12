# Section 4 — Presentation, UX & Testing

## Screen flow

Scene graph lives in `src/ui/scene-manager.ts` (stack machine; transitions are a 150 ms fade). Flow: **Title → Mode → Character Select → Stage Select → Battle → Results**, with Pause as an overlay, not a scene.

1. **Title**: logo, blinking "press attack"; menu items VS Mode / Controls / About.
2. **Mode Select**: Free-for-all or 2 Teams; slot config — 1–4 humans join, remaining of 8 fighter slots filled with CPU bots; duplicate character picks allowed (LF2 style).
3. **Character Select**: 6-portrait grid. A pad presses Attack to join; a colored chip (`P1`–`P4`) docks onto its portrait. Each joined slot cycles **team** (Independent / Red / Blue) with Defend, confirms with Jump. Empty slots show a bot icon with auto-assigned archetype.
4. **Stage Select**: two cards — Grassland Dojo, Rooftop Night — with thumbnail previews; Attack confirms.
5. **Battle**: HUD below; Esc/Start opens the Pause overlay (Resume / Remap / Quit to Menu).
6. **Results**: winner banner (team color) or per-fighter standings sorted by K/D; buttons Rematch / Character Select / Menu.

## HUD

Per fighter, drawn in `src/render/renderer.ts` (HUD pass): red HP bar and blue MP bar (MP regenerates slowly, per brief), 24×24 portrait, name plate, and a **team-colored ring** under the sprite (gray when Independent). Stock count renders only when stocks > 1 (default: off). Bars sit along the top edge, mirrored for right-half fighters; up to 8 fighters stay legible via 2-row layout.

## Input & control defaults

`src/input/router.ts` normalizes keyboard (`event.code`), Gamepad API (standard mapping), and user remaps into one `InputFrame` per slot, consumed by `stepWorld`. Defaults (Attack/Jump/Defend order):

| Slot | Move | Attack / Jump / Defend |
|---|---|---|
| P1 | Arrows | `,` / `.` / `/` |
| P2 | WASD | `F` / `G` / `H` |
| P3 | IJKL | `;` / `,` / `/` |
| P4 | Numpad 8/4/5/6 | `Numpad0` / `Numpad.` / `Numpad+` |

Gamepad (standard mapping): left stick + dpad (buttons 12–15) move; X (2) attack, A (0) jump, B (1) defend; Start (9) pause. Hot-plug handled via `gamepadconnected/disconnected`. P3's default `,`/`/` overlap P1's trio on ANSI layouts; the router ships a documented fallback (P3 Jump `'`, Defend `Enter`) applied when P1 and P3 both join. The **remap UI** (Options screen, reachable from Title and Pause) captures raw keys per action, flags duplicate bindings, persists to `localStorage['tiny.bindings.v1']`.

## Canvas scaling

Internal logical resolution **960×540** (16:9, fits the whole-arena fixed camera and 8 depth-sorted sprites). Backing store stays 960×540; CSS size is integer-scaled: `scale = Math.max(1, Math.floor(Math.min(vw/960, vh/540)))`, centered in a black letterbox container, `image-rendering: pixelated`, `ctx.imageSmoothingEnabled = false`. Resize/orientation events recompute scale only. On integer-DPR displays the backing store may be multiplied by DPR for crispness; fractional DPR falls back to CSS upscale.

## WebAudio plan

`src/audio/audio.ts` wraps one `AudioContext` created **suspended** and resumed on the first pointer/key gesture (autoplay policy); all fetch→`decodeAudioData` work happens lazily after that gesture. Bank: ~15 SFX (`hit_light`, `hit_heavy`, `whiff`, `block`, `jump`, `land`, `dash`, `grab`, `ko`, `weapon_pickup`, `weapon_break`, `item_drop`, `cast_fire`, `cast_ice`, `menu_move`/`menu_confirm`) plus 2 music loops (one per stage) through looping `AudioBufferSourceNode`s. Master/Music/Sfx `GainNode` chain; `M` toggles mute, persisted to `localStorage['tiny.muted']`.

## CPU bot AI

`src/sim/bot.ts` exports pure `botThink(state, self, rng): InputFrame`, called inside the fixed step against a dedicated RNG channel, so replays stay deterministic. A utility scorer ranks candidate actions (approach, retreat, attack-chain, dash-attack, special, dodge, grab, idle):

- **Distance bands** to nearest enemy: < 48 px → attack chains; 48–160 px → approach or dash-attack; > 160 px → approach, or ranged special when MP ≥ cost + reserve floor.
- **Projectile dodge**: scan entities for hostile projectiles whose straight-line extrapolation of current velocity crosses the self hitbox soon; if so, dodge (jump or Defend) outscores everything.
- **Thresholds**: HP < 25 % raises retreat weight; Support mage heals the lowest-HP teammate instead when safe. Team modes target nearest enemy only.
- **Cooldown ticks**: after committing, decisions lock for 12 ticks except emergency dodges — prevents jitter.

No lookahead: only current-frame sheet data is evaluated.

## Testing strategy

Vitest-style suites run with `bun test`. (1) **Hit-resolution units** load fixture sheets from `tests/fixtures/*.json` and assert damage, knockback vectors, i-frames, and blockstun across active-window overlaps and priority clashes. (2) **Golden replay**: a checked-in script `{seed, stage, roster, frames}` feeds the headless runner in `src/main.ts` behind a `HEADLESS=1` env flag; the runner hashes canonical final-state JSON (sha256) and compares against the golden file — any sim nondeterminism fails CI. (3) **Input-mapper tests**: synthetic `KeyboardEvent`s and fake gamepad snapshots produce expected `InputFrame`s, including remap persistence and the P3 fallback.

## Failure handling

Missing/corrupt data file (sheet JSON fails parse or schema validation at boot): full-screen **error overlay** naming the exact file and reason, with Reload; boot halts before Title. Art load failure: magenta placeholder box (`#FF00FF`) sized to the tile's declared frame box, logged warning, battle continues. Audio failure (404/decode error): silent continue — the engine marks the sound unavailable and never throws into the game loop.
