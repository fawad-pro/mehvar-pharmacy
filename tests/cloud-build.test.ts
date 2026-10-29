/**
 * The cloud image bundles the same scripts as the Windows installer (PCN-019).
 *
 * `build-cloud.ts` is a sibling of `build.ts`, not a caller of it, so the two
 * lists are pinned against each other: a script added to the installer and
 * forgotten in the image is exactly the Day 12 shape — everything green, the
 * path broken.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), 'utf8');

function entrypoints(source: string): string[] {
  return [...source.matchAll(/'(scripts\/[a-z/-]+\.ts)'/g)].map((m) => m[1] as string);
}

describe('the cloud image', () => {
  it('bundles every script the installer does, bar the Windows service entry point', () => {
    const installer = entrypoints(read('scripts', 'package', 'build.ts')).filter(
      (entry) => entry !== 'scripts/ops/serve.ts',
    );
    const cloud = entrypoints(read('scripts', 'package', 'build-cloud.ts'));
    for (const entry of installer)
      expect(cloud, `${entry} missing from build-cloud.ts`).toContain(entry);
  });

  it('runs in cloud mode, as a non-root user, on the platform port', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('MEHVAR_DEPLOYMENT=cloud');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HOSTNAME=0.0.0.0');
  });

  it('the server action key is passed to the build, not left random', () => {
    expect(read('Dockerfile')).toContain('ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY');
  });
});
