import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { currentRelease, parseRelease } from './release';

/**
 * The installed build's identity. Every build used to be "0.0.0" and every
 * installer-provisioned machine recorded "unknown", so a support bundle could
 * not say which release a shop ran.
 */
describe('release identity', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reads the build package:build stamps, commit and all', () => {
    dir = mkdtempSync(join(tmpdir(), 'mehvar-version-'));
    const file = join(dir, 'VERSION');
    writeFileSync(
      file,
      JSON.stringify({
        version: '1.0.0',
        build: '1.0.0+4467271abcde',
        commit: '4467271abcde',
        builtAt: '2026-10-21T00:00:00Z',
      }),
    );
    expect(currentRelease(file)).toEqual({
      version: '1.0.0',
      build: '1.0.0+4467271abcde',
      commit: '4467271abcde',
      builtAt: '2026-10-21T00:00:00Z',
    });
  });

  it('reads a VERSION written before builds carried a commit', () => {
    expect(parseRelease('{"version":"0.0.0","builtAt":"2026-09-23T23:18:01.111Z"}')?.build).toBe(
      '0.0.0',
    );
  });

  it('says plainly when it is not a packaged build, rather than "unknown"', () => {
    const release = currentRelease(join(tmpdir(), 'no-such-dir', 'VERSION'));
    expect(release.build).toMatch(/\+development$/);
    expect(release.commit).toBeUndefined();
  });

  it('refuses garbage rather than reporting it as a version', () => {
    expect(parseRelease('not json')).toBeUndefined();
    expect(parseRelease('{"build":"x"}')).toBeUndefined();
  });
});
