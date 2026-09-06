import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('scaffold', () => {
  it('declares required dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies.three).toBeDefined();
    expect(pkg.dependencies['@dimforge/rapier3d-compat']).toBeDefined();
  });
});
