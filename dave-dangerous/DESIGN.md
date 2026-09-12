# Dangerous Dave — AAA Presentation Overhaul (Three.js)

## Mission

Rebuild the presentation of the existing, tested Dangerous Dave remake to a
current-AAA standard. The simulation core (`src/core`, `src/world`, `src/entities`,
`src/state`, `src/levels`) is deterministic and covered by vitest — **it must not
change**. Everything the player *sees and hears* is replaced: Canvas2D pixel
renderer → Three.js cinematic 2.5D, DOM cards → full AAA UI/UX, beeps → layered
procedural audio.

## Art direction — "CATACOMB DEPTHS"

Cinematic 2.5D side-scroller. Reference bar (compare blindly against these):
*Ori and the Will of the Wisps*, *Inside* (Playdead), *Little Nightmares*,
*Dead Cells*, *Prince of Persia: The Lost Crown*.

- **World**: a crumbling underground vault. Foreground playfield tiles are 3D
  blocks with real depth/bevel; 3–4 parallax layers recede into fog behind them.
- **Lighting**: single warm key (moonshaft/torch), cool ambient bounce, rim
  light on the hero. Lava trenches and gems are real light emitters.
- **Palette**: deep teal-slate caverns `#0d1b22 → #16323d`, warm ember/gold
  accents `#ffb347 / #ffd27a`, hero crimson `#c93b2e`, moss greens `#3e6b4f`.
  UI: near-black glass panels, gold hairline borders, ember highlights.
- **Materials**: PBR everywhere. Procedural canvas textures (albedo + normal +
  roughness). No flat MeshBasicMaterial on world geometry.
- **Motion**: every entity animates (idle bob, run cycle, gem spin, flame
  flicker). Post-FX: bloom, vignette, film grain, subtle chromatic aberration,
  ACES tone mapping. Camera eases, leads the player, shakes on death.

## Units & coordinates

Simulation is 20×13 tiles of 16 px = **320×200 px**. The 3D view maps
**1 tile = 1 world unit**. `worldTo3D(x_px, y_px)` → `x = px/16`, `y = -py/16`
(y flips: sim +y is down, three +y is up), `z = 0` playfield plane.
Camera default z ≈ 11–13, fov ≈ 40°, framing the full 20×13 playfield with
cinematic letterbox headroom.

## Module map & ownership (agents touch ONLY their files)

| File | Owner | Responsibility |
|---|---|---|
| `src/render3d/palette.ts` | core | design tokens, shared colors |
| `src/render3d/textures.ts` | WORLD | procedural texture factory |
| `src/render3d/materials.ts` | WORLD | PBR material library |
| `src/render3d/WorldView.ts` | WORLD | tile meshes, parallax, fog, props |
| `src/render3d/DaveView.ts` | CHARS | hero mesh, animation states, jetpack flame |
| `src/render3d/EntitiesView.ts` | CHARS | spider/items/door/bullet views |
| `src/render3d/Particles.ts` | VFX | gameplay particle systems + pool |
| `src/render3d/PostFX.ts` | VFX | composer chain + grade shader |
| `src/render3d/CameraRig.ts` | VFX | cinematic camera, shake, menu diorama |
| `src/render3d/Lighting.ts` | core | light rig (key/fill/rim/embers) |
| `src/render3d/GameView.ts` | core | orchestration, per-frame sync from World |
| `src/render3d/ui/*` | UI | DOM overlay: menu, HUD, cards, settings |
| `index.html` | UI | page shell + overlay markup + fonts |
| `src/audio/CinematicAudio.ts` | AUD | layered procedural score + SFX synth |

## Contracts (stubs compile today; keep signatures)

```ts
// GameView.ts (core) — game.ts calls only this
class GameView {
  constructor(container: HTMLElement);
  sync(world: World, dtReal: number, uiState: RenderUiState): void; // per frame
  fx: FxHooks;                      // collect/death/land/jetpack/shoot/door...
  setMenuMode(on: boolean): void;   // slow diorama cam for the title screen
  resize(w: number, h: number): void;
  dispose(): void;
}
interface RenderUiState { flow: "menu"|"playing"|"paused"|"gameover"|"clear";
  score: number; lives: number; level: number; hasGun: boolean;
  fuel: number; fuelMax: number; lowFuel: boolean; }
interface FxHooks { collect(kind: string, at: {x:number;y:number}): void;
  death(at: {x:number;y:number}): void; land(at: {x:number;y:number}): void;
  shoot(at: {x:number;y:number}): void; doorOpen(at: {x:number;y:number}): void;
  jetpack(on: boolean): void; warp(): void; }
```

UI reads `RenderUiState` through a callback; it never imports the sim.
Audio receives the same event bus the sim already emits (`src/core/Events.ts`)
plus explicit calls from `game.ts`; keep `AudioEngine` API for tests.

## Quality gates (the critic enforces these)

1. No flat untextured color fields on world geometry; visible bevel/AO.
2. Bloom only where emission is authored (gems, lava, flames, door light).
3. Hero readable at a glance: silhouette + rim light + warm-vs-cool contrast.
4. Every animation eased; nothing snaps except gameplay collision.
5. UI: no monospace default font, no raw browser focus rings, consistent
   8-px spacing grid, gold-hairline glass panels, animated transitions.
6. 60 fps target: merged tile geometry, shared materials, particle pooling.
7. Console clean; no TypeScript `any` leaks into the sim.
