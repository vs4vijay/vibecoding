# Section 3 — Content Pipeline

All gameplay content is plain JSON under `src/data/`, fetched and validated once by `src/content/loader.ts` before `spawnMatch()` runs. Sheets contain literal numbers only — no computed or random values. Every stochastic decision (sky-drop rolls, bot jitter) draws from the sim's seeded RNG (§2.5) in fixed order, so replay hashes stay stable regardless of content or load timing.

## 3.1 Data layout

```
src/data/
├── characters/            # one sheet per archetype
│   ├── brawler.json       # embeds its own projectile defs (mirrors LF2 .dat)
│   └── …
├── stages/
│   ├── grassland-dojo.json
│   └── rooftop-night.json
├── weapons.json           # knife, baseball-bat, boulder, box
└── items.json             # milk, beer
```

Two small extensions to §2.1, owned here: `MoveDef = { frames: MoveFrame[]; sequence?: string }` — `sequence` feeds the §2.6 matcher (`"D>A"`); and `CharacterSheet.roles: Record<string,string>` maps generic FSM slots (e.g. `dashAttack`) to move ids. Projectiles resolve sheet-locally: `spawnProjectile.projectileId` indexes `sheet.projectiles`.

## 3.2 Worked example — `characters/brawler.json`

```json
{
  "id": "brawler",
  "maxHp": 240, "maxMp": 100, "mpRegenPerTick": 0.05,
  "walkSpeed": 2.2, "runSpeed": 5.0, "jumpImpulse": -8.5,
  "grabMoveId": "grappleSlam",
  "roles": { "dashAttack": "flyingKnee" },
  "moves": {
    "punch1": { "frames": [
      { "sprite": "br_p1_windup", "durationTicks": 3, "vx": 0.6, "vy": 0, "vz": 0 },
      { "sprite": "br_p1_active", "durationTicks": 4, "vx": 1.4, "vy": 0, "vz": 0,
        "cancelInto": ["punch2"],
        "hitbox": { "x": 26, "y": -34, "z": 0, "w": 30, "h": 18, "d": 44,
          "damage": 8, "knockback": { "vx": 1.5, "vy": 0 }, "hitstunTicks": 14,
          "type": "light", "priority": 10 } },
      { "sprite": "br_p1_recover", "durationTicks": 5, "vx": 0, "vy": 0, "vz": 0,
        "cancelInto": ["punch2"] } ] },
    "punch2": { "frames": [
      { "sprite": "br_p2_windup", "durationTicks": 3, "vx": 0.6, "vy": 0, "vz": 0 },
      { "sprite": "br_p2_active", "durationTicks": 4, "vx": 1.8, "vy": 0, "vz": 0,
        "cancelInto": ["punch3"],
        "hitbox": { "x": 27, "y": -34, "z": 0, "w": 32, "h": 18, "d": 44,
          "damage": 10, "knockback": { "vx": 2.0, "vy": 0 }, "hitstunTicks": 16,
          "type": "light", "priority": 10 } },
      { "sprite": "br_p2_recover", "durationTicks": 6, "vx": 0, "vy": 0, "vz": 0,
        "cancelInto": ["punch3"] } ] },
    "punch3": { "frames": [
      { "sprite": "br_p3_windup", "durationTicks": 5, "vx": 0.4, "vy": 0, "vz": 0 },
      { "sprite": "br_p3_active", "durationTicks": 4, "vx": 2.2, "vy": 0, "vz": 0,
        "hitbox": { "x": 28, "y": -36, "z": 0, "w": 34, "h": 24, "d": 44,
          "damage": 16, "knockback": { "vx": 3.5, "vy": -6.0 }, "hitstunTicks": 24,
          "type": "heavy", "priority": 12 } },
      { "sprite": "br_p3_recover", "durationTicks": 9, "vx": 0, "vy": 0, "vz": 0 } ] },
    "flyingKnee": { "frames": [
      { "sprite": "br_knee_crouch", "durationTicks": 2, "vx": 3.0, "vy": 0, "vz": 0 },
      { "sprite": "br_knee_active", "durationTicks": 8, "vx": 5.0, "vy": 0, "vz": 0,
        "hitbox": { "x": 24, "y": -38, "z": 0, "w": 30, "h": 22, "d": 44,
          "damage": 18, "knockback": { "vx": 3.0, "vy": -6.0 }, "hitstunTicks": 30,
          "type": "heavy", "priority": 20 } },
      { "sprite": "br_knee_land", "durationTicks": 6, "vx": 0, "vy": 0, "vz": 0 } ] },
    "energyBlast": { "sequence": "D>A", "frames": [
      { "sprite": "br_blast_windup", "durationTicks": 6, "vx": 0, "vy": 0, "vz": 0, "mpCost": 25 },
      { "sprite": "br_blast_cast", "durationTicks": 4, "vx": 0, "vy": 0, "vz": 0,
        "spawnProjectile": { "projectileId": "energyShot", "offsetX": 28, "offsetY": -36 } },
      { "sprite": "br_blast_recover", "durationTicks": 8, "vx": 0, "vy": 0, "vz": 0 } ] },
    "grappleSlam": { "frames": [
      { "sprite": "br_grab_reach", "durationTicks": 3, "vx": 1.2, "vy": 0, "vz": 0 },
      { "sprite": "br_grab_hold", "durationTicks": 4, "vx": 0, "vy": 0, "vz": 0,
        "hitbox": { "x": 18, "y": -36, "z": 0, "w": 22, "h": 30, "d": 40,
          "damage": 0, "knockback": { "vx": 0, "vy": 0 }, "hitstunTicks": 0,
          "type": "grab", "priority": 25 } },
      { "sprite": "br_grab_slam", "durationTicks": 10, "vx": 0, "vy": 0, "vz": 0 } ] }
  },
  "projectiles": {
    "energyShot": { "sprite": "fx_energy_shot", "size": { "w": 24, "h": 14, "d": 14 },
      "velocityVx": 7.0, "gravity": 0, "ttlTicks": 130, "pierce": false,
      "damage": 15, "knockback": { "vx": 3.0, "vy": -1.0 }, "hitstunTicks": 18,
      "type": "projectile", "priority": 15 }
  }
}
```

Frame indexing is absolute per move (ticks since move start). `punch1` spans ticks 0–11; its hitbox is live ticks 3–6, and `cancelInto: ["punch2"]` opens the chain window there — Attack pressed during ticks 3–11 reroutes into `punch2` (ticks 0–12), then `punch3`. `punch3` launches at `vy: -6.0` (`KNOCKDOWN_LAUNCH_VY`, §2.3), forcing Knockdown. `flyingKnee` is the dash attack: 16 ticks at `RUN_DASH_SPEED` with the same guaranteed launch. `energyBlast` charges 25 MP once at move start (§2.1), spawns `energyShot` at tick 6, and recovers through tick 17; the shot flies straight (`gravity: 0`, 910 px range), hits once, despawns on wall or TTL.

## 3.3 Weapons — `weapons.json`

```json
{
  "knife":        { "kind": "thrown", "meleeDamage": 12, "throwDamage": 28, "throwVy": -4.0, "durability": 3, "breakOnThrowImpact": true,  "carrierSpeedMul": 1.0,  "repickupDelayTicks": 20 },
  "baseball-bat": { "kind": "melee",  "meleeDamage": 26, "throwDamage": 14, "throwVy": -3.0, "durability": 8, "breakOnThrowImpact": false, "carrierSpeedMul": 0.95, "repickupDelayTicks": 20 },
  "boulder":      { "kind": "heavy",  "meleeDamage": 34, "throwDamage": 45, "throwVy": -7.0, "durability": 1, "breakOnThrowImpact": true,  "carrierSpeedMul": 0.55, "repickupDelayTicks": 60 },
  "box":          { "kind": "heavy",  "meleeDamage": 18, "throwDamage": 22, "throwVy": -5.0, "durability": 2, "breakOnThrowImpact": true,  "carrierSpeedMul": 0.75, "repickupDelayTicks": 30 }
}
```

Durability decrements per landed melee swing; at 0 the weapon emits a `weaponBreak` SimEvent and despawns. Throwing always expends the held instance; `breakOnThrowImpact` destroys it on first fighter/wall contact, otherwise it drops as a pickup. `carrierSpeedMul` scales walk/run while held (boulder = crawl); `repickupDelayTicks` blocks instant re-grab after a drop.

## 3.4 Items — `items.json`

```json
{
  "milk": { "effect": "healHp",    "amount": 90, "consumeTicks": 30, "shelfLifeTicks": 1200 },
  "beer": { "effect": "restoreMp", "amount": 60, "consumeTicks": 30, "shelfLifeTicks": 1200 }
}
```

Consuming locks the drink animation for `consumeTicks`; the effect applies on completion and is cancelled if the drinker takes a hit mid-animation. Untouched items despawn after `shelfLifeTicks`.

## 3.5 Stages — `stages/*.json`

```json
{
  "id": "grassland-dojo",
  "bounds": { "w": 1600, "h": 480, "d": 120 },
  "walls": { "left": 0, "right": 1600, "restitution": 0.4 },
  "layers": [
    { "atlasKey": "bg_dojo_sky",   "parallax": 0.15, "baselineY": 96 },
    { "atlasKey": "bg_dojo_hills", "parallax": 0.4,  "baselineY": 208 },
    { "atlasKey": "bg_dojo_floor", "parallax": 1.0,  "baselineY": 420 }
  ],
  "drops": {
    "firstDropTick": 600, "intervalTicks": 900, "intervalJitterTicks": 180,
    "table": { "milk": 3, "beer": 3, "knife": 2, "baseball-bat": 2, "boulder": 1, "box": 2 }
  }
}
```

`bounds` must sit within the 1600×480×120 nominal arena (§2.3); `walls` override restitution per side. Layers composite back-to-front; with the fixed whole-arena camera, fractional parallax only shifts during screenshake. Sky-drop cadence: first crate at tick 600, then every `intervalTicks ± jitter` (drawn from the seeded RNG, never stored in JSON). Each drop performs exactly three ordered RNG draws — weighted table pick, x ∈ `[80, w−80]`, z ∈ depth band — so any seed replays identically. `rooftop-night.json` shortens cadence (`intervalTicks: 720`) and skews hardware: `{"milk":2,"beer":2,"knife":3,"baseball-bat":3,"boulder":1,"box":4}`.

## 3.6 Art sourcing & atlas conventions

All art from Kenney (kenney.nl), **CC0 1.0 Universal** — public-domain dedication, no attribution required, commercial use permitted:

| Need | Kenney pack |
|---|---|
| Fighter poses (≤64px, side view) | Tiny Dungeon |
| Weapon/item icons | Roguelike/RPG pack |
| Blast/hit FX | Particle Pack |
| Stage tiles & backdrops | Pixel Platformer |

Locked decision 4 stands: no ripped LF2 sprites or portraits. We still keep `public/assets/CREDITS.txt` listing pack URLs for provenance. Atlases are per-category twins in `public/assets/atlas/`: `fighters`, `props`, `fx`, `bg` — each `*.png` + `*.json`. PNGs are power-of-two canvases (512²–1024², RGBA); JSON is a frame array `{name, x, y, w, h, pivotX, pivotY}` where `name` matches `MoveFrame.sprite` verbatim. Frames get a 1px transparent gutter, are packed at native pixel size (never smoothly resampled), and sample nearest-neighbor (`imageSmoothingEnabled = false`, CSS `pixelated`, §4). Fighter pivots sit at feet-center for z-sorting by ground point (§1 renderer).

## 3.7 Load-time validation

Hand-rolled validators in `src/content/schema.ts` — zero dependencies, closed objects, exact pointers; zod was rejected because its default-loose object shapes would hide the typo/nondeterminism classes we must catch. Shape:

```ts
export interface FieldError { file: string; pointer: string; message: string }
// pointer e.g. "moves.punch3.frames[1].hitbox.damage"
export function validateCharacterSheet(raw: unknown, file: string): FieldError[]
```

`loader.ts` pipeline: `Promise.all` fetch → parse (a `SyntaxError` becomes a file-level `FieldError`) → `validate*` per kind → cross-link pass → deep `Object.freeze` → typed cache. Errors accumulate across **all** files, then one `ContentLoadError` reports every violation (`file :: pointer — message`); the battle scene refuses to construct `WorldState` until the report is empty, halting boot before Title (error overlay, §4). Cross-link checks: `cancelInto`/`nextFrameLink`/`roles` reference declared moves; `spawnProjectile.projectileId` exists in `sheet.projectiles`; drop-table ids exist in `weapons ∪ items`; all velocities finite; melee/heavy durability ≥ 1. Closed schemas reject undeclared keys everywhere, which structurally enforces "no random fields" in content.
