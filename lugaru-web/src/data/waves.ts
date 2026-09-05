/**
 * Wave configurations [spec §8]: each wave defines the enemy roster that
 * spawns in the arena. Pure data — no sim, no three/Rapier.
 */

export interface EnemyEntry {
  species: 'wolf' | 'rabbit';
  count: number;
}

export interface WaveConfig {
  id: string;
  label: string;
  enemies: readonly EnemyEntry[];
}

export const WAVES: readonly WaveConfig[] = [
  { id: 'wave1', label: 'Wave 1', enemies: [{ species: 'wolf', count: 1 }] },
  { id: 'wave2', label: 'Wave 2', enemies: [{ species: 'wolf', count: 1 }, { species: 'rabbit', count: 1 }] },
  { id: 'wave3', label: 'Wave 3', enemies: [{ species: 'wolf', count: 2 }, { species: 'rabbit', count: 1 }] },
];
