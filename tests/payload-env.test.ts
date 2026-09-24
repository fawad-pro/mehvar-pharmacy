/**
 * The build machine's `.env` never reaches a pharmacy — see payload-env.ts.
 *
 * Found by the upgrade test: `dist/package/app/.env` was byte-identical to the
 * packager's `.env`, and a key present only there was visible to the running
 * server. The rules are tested directly; the three places that must apply them
 * are tested by reading their source, because the failure being prevented is a
 * layer quietly not calling the rule, and no packaging run happens in CI.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertNoEnvFiles,
  envFilesIn,
  isEnvFileName,
  stripEnvFiles,
} from '../scripts/package/payload-env';

const read = (...path: string[]): string => readFileSync(join(process.cwd(), ...path), 'utf8');

describe('isEnvFileName', () => {
  it('matches the whole .env family Next can copy', () => {
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.production.local',
      '.env.example',
    ]) {
      expect(isEnvFileName(name)).toBe(true);
    }
  });

  it('does not match files that merely contain the letters', () => {
    for (const name of [
      'server.js',
      'env.ts',
      'my.env',
      '.envrc',
      '.environment',
      'package.json',
    ]) {
      expect(isEnvFileName(name)).toBe(false);
    }
  });
});

describe('stripping a payload', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function payload(): string {
    dir = mkdtempSync(join(tmpdir(), 'mehvar-payload-'));
    writeFileSync(join(dir, '.env'), 'DATABASE_ADMIN_URL=postgresql://mehvar:secret@x/y\n');
    writeFileSync(join(dir, '.env.production'), 'SESSION_SECRET=build-machine\n');
    writeFileSync(join(dir, 'server.js'), '// the server\n');
    mkdirSync(join(dir, '.next'));
    return dir;
  }

  it('removes every .env-family file and nothing else', () => {
    const app = payload();
    expect(stripEnvFiles(app)).toEqual(['.env', '.env.production']);
    expect(envFilesIn(app)).toEqual([]);
    expect(existsSync(join(app, 'server.js'))).toBe(true);
    expect(existsSync(join(app, '.next'))).toBe(true);
  });

  it('refuses a payload that still holds one, naming it', () => {
    const app = payload();
    expect(() => assertNoEnvFiles(app)).toThrow(/\.env, .*\.env\.production/);
    stripEnvFiles(app);
    expect(() => assertNoEnvFiles(app)).not.toThrow();
  });
});

describe('every layer applies it', () => {
  it('package:build strips right after copying the standalone server', () => {
    const build = read('scripts', 'package', 'build.ts');
    const copy = build.indexOf("cpSync(standalone, join(out, 'app')");
    const strip = build.indexOf("stripEnvFiles(join(out, 'app'))");
    expect(copy).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(copy);
    // …and proves it at the end, after everything else has been copied in.
    expect(build.lastIndexOf("assertNoEnvFiles(join(out, 'app'))")).toBeGreaterThan(strip);
  });

  it('package:installer refuses a payload that still carries one', () => {
    const installer = read('scripts', 'package', 'build-installer.ts');
    const check = installer.indexOf("assertNoEnvFiles(join(payload, 'app'))");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(installer.indexOf('execFileSync(iscc'));
  });

  it('mehvar.iss excludes the same names from the app payload', () => {
    const appLine = read('packaging', 'windows', 'mehvar.iss')
      .split('\n')
      .find((line) => line.startsWith('Source: "{#PayloadDir}\\app\\*"'));
    expect(appLine).toBeDefined();
    expect(appLine).toMatch(/Excludes: "\.env,\.env\.\*"/);
  });
});

describe('an upgrade removes the file older installers shipped', () => {
  it('mehvar.iss deletes {app}\\app\\.env* before installing ([Files] never deletes)', () => {
    const iss = read('packaging', 'windows', 'mehvar.iss');
    const section = iss.slice(iss.indexOf('[InstallDelete]'), iss.indexOf('[Dirs]'));
    expect(section).toContain('Type: files; Name: "{app}\\app\\.env"');
    expect(section).toContain('Type: files; Name: "{app}\\app\\.env.*"');
  });
});
