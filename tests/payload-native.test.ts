/**
 * The payload carries the Windows argon2 binary, whatever machine built it.
 *
 * Next traces the native binary for the platform the build runs on, so a
 * payload assembled on Linux held only the Linux builds of @node-rs/argon2 —
 * and the guard passed anyway, because it checked the build machine's
 * node_modules rather than the payload. The installed counter would then have
 * failed at its first PIN hash: the login screen. Found by listing a real
 * payload during release verification; this pins the fix's wiring.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const build = readFileSync(join(process.cwd(), 'scripts', 'package', 'build.ts'), 'utf8');

describe('package:build and the Windows argon2 binary', () => {
  it('copies it into the payload after the standalone server is assembled', () => {
    const copy = build.indexOf("cpSync(standalone, join(out, 'app')");
    const bundle = build.indexOf('  bundleWindowsNativeModules();');
    expect(copy).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(copy);
  });

  it('checks the PAYLOAD for the .node file, not only the build machine', () => {
    const body = build.slice(build.indexOf('function bundleWindowsNativeModules'));
    expect(body).toContain("join(out, 'app', 'node_modules', name");
    expect(body).toMatch(/throw new Error/);
  });
});
