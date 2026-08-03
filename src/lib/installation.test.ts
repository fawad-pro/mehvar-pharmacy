import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureInstallation,
  installationDir,
  installationFile,
  readInstallation,
  type EnvLike,
} from './installation';

const created: string[] = [];

function scratchEnv(): EnvLike {
  const dir = mkdtempSync(join(tmpdir(), 'mehvar-install-'));
  created.push(dir);
  return { MEHVAR_DATA_DIR: dir };
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('installation directory', () => {
  it('prefers MEHVAR_DATA_DIR over any platform default', () => {
    expect(installationDir({ MEHVAR_DATA_DIR: '/srv/mehvar' })).toBe('/srv/mehvar');
  });

  it('treats an empty override as unset rather than as the root directory', () => {
    // An installer that exports MEHVAR_DATA_DIR= with no value would otherwise
    // put the record at the filesystem root.
    expect(installationDir({ MEHVAR_DATA_DIR: '' })).not.toBe('');
  });

  it('puts the file inside the directory', () => {
    const env = { MEHVAR_DATA_DIR: '/srv/mehvar' };
    expect(installationFile(env)).toBe(join('/srv/mehvar', 'installation.json'));
  });
});

describe('minting the installation identity', () => {
  it('reports no record before an install has run', () => {
    expect(readInstallation(scratchEnv())).toBeUndefined();
  });

  it('mints once and returns the same identity on every later call', () => {
    const env = scratchEnv();

    const first = ensureInstallation('1.0.0', env);
    const second = ensureInstallation('1.1.0', env);

    // The guarantee that matters: a repair install, or an installer that runs
    // twice, must not give one machine two identities — the support trail is
    // keyed on this id.
    expect(second).toEqual(first);
    expect(second.installedVersion).toBe('1.0.0');
  });

  it('round-trips through the file', () => {
    const env = scratchEnv();
    const minted = ensureInstallation('1.0.0', env);

    expect(readInstallation(env)).toEqual(minted);
  });

  it('mints a UUIDv7, so installations stay mergeable', () => {
    // Part 1 §5: two installations' records must be combinable without a
    // collision. Version nibble 7 is what makes that true by construction.
    const { installationId } = ensureInstallation('1.0.0', scratchEnv());

    expect(installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('a damaged installation file', () => {
  it('refuses to read malformed JSON rather than minting a second identity', () => {
    const env = scratchEnv();
    writeFileSync(installationFile(env), '{ not json', 'utf8');

    expect(() => readInstallation(env)).toThrow(/not valid JSON/);
  });

  it('refuses a file missing required fields', () => {
    const env = scratchEnv();
    writeFileSync(installationFile(env), JSON.stringify({ installedAt: 'x' }), 'utf8');

    expect(() => readInstallation(env)).toThrow(/missing required fields/);
  });

  it('does not silently replace a damaged file when ensuring', () => {
    const env = scratchEnv();
    writeFileSync(installationFile(env), '{ not json', 'utf8');

    // Overwriting would mint a second identity for a machine that already has
    // one, and the support trail would go quiet exactly when someone is
    // following it.
    expect(() => ensureInstallation('1.0.0', env)).toThrow(/not valid JSON/);
  });
});
