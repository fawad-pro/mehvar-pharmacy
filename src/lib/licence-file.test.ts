import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureInstallation, readInstallation, writeInstallation } from './installation';
import { licenceFile, readLicenceFile, writeLicenceFile } from './licence-file';

const dirs: string[] = [];

function scratch(): { MEHVAR_DATA_DIR: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mehvar-licence-'));
  dirs.push(dir);
  return { MEHVAR_DATA_DIR: dir };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the licence file', () => {
  it('round-trips a token', () => {
    const env = scratch();
    expect(writeLicenceFile('MEHVAR1.a.b', env)).toBe(true);
    expect(readLicenceFile(env)).toBe('MEHVAR1.a.b');
  });

  it('treats a missing file as "no token", never an error', () => {
    // A licence question must not be able to stop a Node from coming up.
    expect(readLicenceFile(scratch())).toBeUndefined();
  });

  it('treats an empty file as "no token"', () => {
    const env = scratch();
    mkdirSync(env.MEHVAR_DATA_DIR, { recursive: true });
    writeFileSync(licenceFile(env), '   \n', 'utf8');
    expect(readLicenceFile(env)).toBeUndefined();
  });
});

describe('installation identity — restore before minting', () => {
  it('mints when nothing is known', () => {
    const env = scratch();
    const record = ensureInstallation('1.0.0', env);
    expect(record.installationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('adopts the database’s answer rather than minting a new identity', () => {
    // A cleaned %ProgramData% on a machine the database still remembers. Minting
    // here would silently unbind a paying pharmacy AND reset its trial anchor.
    const env = scratch();
    const known = {
      installationId: '11111111-1111-7111-8111-111111111111',
      installedAt: '2026-01-01T00:00:00.000Z',
    };
    const record = ensureInstallation('1.2.0', env, known);

    expect(record.installationId).toBe(known.installationId);
    expect(record.installedAt).toBe(known.installedAt);
    expect(readInstallation(env)?.installationId).toBe(known.installationId);
  });

  it('never overwrites an identity this machine already has', () => {
    const env = scratch();
    const first = ensureInstallation('1.0.0', env);
    const second = ensureInstallation('2.0.0', env, {
      installationId: '99999999-9999-7999-8999-999999999999',
      installedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(second.installationId).toBe(first.installationId);
  });

  it('writeInstallation refills a file the database can still describe', () => {
    const env = scratch();
    const record = {
      installationId: '22222222-2222-7222-8222-222222222222',
      installedAt: '2026-02-02T00:00:00.000Z',
      installedVersion: '1.3.0',
    };
    writeInstallation(record, env);
    expect(readInstallation(env)).toEqual(record);
  });
});
