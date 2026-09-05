/**
 * Combat domain types — plain data only.
 *
 * HARD RULE: nothing under src/combat/ or src/data/ may import three/Rapier.
 * Everything here is a pure snapshot the resolver reads; the controller and
 * renderer translate live class state into these snapshots each step.
 *
 * `Stance` is deliberately re-declared here instead of importing from
 * src/actors/controller.ts: combat stays decoupled from actors, and the two
 * unions are structurally identical so values flow across without casts.
 */
export {};
