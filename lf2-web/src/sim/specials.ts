import type { PressRecord, Token } from "./inputBuffer";

export function compilePattern(seq: string): Token[] {
  return seq.split("") as Token[];
}

/**
 * Scans the press log for the longest pattern whose tokens appear in order.
 * Across ticks the log reads newest-first, but within a single tick tokens
 * keep their emission (log) order — a same-tick chord only satisfies a
 * pattern spelled in that chord's own order. Matching therefore walks ticks
 * oldest→newest and each tick's slice forward (a plain subsequence test over
 * the temporal log). Every consumed token must sit within windowTicks of
 * nowTick. Longest pattern wins ties.
 */
export function matchSpecial(
  log: PressRecord[],
  nowTick: number,
  windowTicks: number,
  patterns: Record<string, string>,
): string | null {
  const compiled = Object.entries(patterns)
    .map(([moveId, seq]) => ({ moveId, tokens: compilePattern(seq) }))
    .sort((a, b) => b.tokens.length - a.tokens.length);

  // Group entries per tick (same-tick entries are contiguous in the log),
  // dropping anything older than the window; groups end up oldest-last.
  const groups: PressRecord[][] = [];
  for (const rec of log) {
    if (nowTick - rec.tick > windowTicks) break; // older entries only get staler
    const g = groups[groups.length - 1];
    if (g && g[0]!.tick === rec.tick) g.push(rec);
    else groups.push([rec]);
  }

  for (const { moveId, tokens } of compiled) {
    let ti = 0;                                     // next needed token
    for (let gi = groups.length - 1; gi >= 0; gi--) { // oldest tick → newest
      for (const rec of groups[gi]!) {               // within tick: emission order
        if (rec.token === tokens[ti]) ti++;
        if (ti === tokens.length) return moveId;
      }
    }
  }
  return null;
}
