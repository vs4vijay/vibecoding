/**
 * Test runner: discovers every `scripts/*-test.mjs` harness and runs each as
 * a child `node` process, in alphabetical order. Exits non-zero on the first
 * failure (harness output streams through, so failures are visible inline).
 *
 * Plain node, no framework — mirrors the harnesses' own zero-dependency rule.
 *
 * @returns {Promise<void>} Rejects when any harness fails.
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const harnesses = readdirSync(here)
  .filter((f) => f.endsWith('-test.mjs'))
  .sort();

let failed = 0;
for (const file of harnesses) {
  process.stdout.write(`\n=== ${file} ===\n`);
  const res = spawnSync(process.execPath, [join(here, file)], {
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    failed += 1;
    process.stdout.write(`--- ${file} FAILED ---\n`);
  }
}

process.stdout.write(
  `\n${harnesses.length} harnesses run, ${failed} failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
