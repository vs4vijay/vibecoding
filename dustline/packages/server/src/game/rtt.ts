import type { ServerPlayer } from './types.js';

/** Round-trip samples outside [RTT_SAMPLE_MIN_MS, RTT_SAMPLE_MAX_MS] are treated as bogus. */
export const RTT_SAMPLE_MIN_MS = 0;
export const RTT_SAMPLE_MAX_MS = 5000;

/** Weight of a new sample in the RTT EWMA (history keeps 1 - alpha). */
const RTT_EWMA_ALPHA = 0.25;

/** Clamp a raw pong round-trip sample into the sane range. */
export function clampRttSample(sampleMs: number): number {
  return Math.min(RTT_SAMPLE_MAX_MS, Math.max(RTT_SAMPLE_MIN_MS, sampleMs));
}

/**
 * Blend one round-trip sample into the player's RTT estimate. The first
 * sample (current 0) seeds the EWMA outright; after that the new sample
 * carries 25% of the weight.
 */
export function updateRttEwma(currentRttMs: number, sampleMs: number): number {
  const sample = clampRttSample(sampleMs);
  return currentRttMs === 0 ? sample : currentRttMs * (1 - RTT_EWMA_ALPHA) + sample * RTT_EWMA_ALPHA;
}

/**
 * Feed one pong round trip (sentAtMs → recvNowMs) into the player's EWMA.
 * Malformed samples (non-finite, e.g. a garbage echoed timestamp) are ignored
 * so a bad pong cannot corrupt the estimate; finite samples are clamped
 * before blending, so hostile pings cannot push RTT outside [0, 5000] ms.
 */
export function applyRttSample(player: ServerPlayer, sentAtMs: number, recvNowMs: number): void {
  const sampleMs = recvNowMs - sentAtMs;
  if (!Number.isFinite(sampleMs)) return;
  player.rttMs = updateRttEwma(player.rttMs, sampleMs);
}
