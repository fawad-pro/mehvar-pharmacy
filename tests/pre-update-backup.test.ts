/**
 * Backup before update — the wiring no single script can see.
 *
 * The upgrade test found that an update took no backup: nothing between the
 * operator clicking Install and install-services.ps1 migrating the schema made
 * a copy of the pharmacy's records. `pre-update-backup.ps1` now does, from
 * mehvar.iss's PrepareToInstall. Its decisions are pinned by
 * `pre-update-backup.tests.ps1` (run by `lint:ps`); this pins the facts that
 * span files, which is where a drift would hide:
 *
 *   - Setup runs it BEFORE installing anything, and stops if it fails.
 *   - Both scripts it needs are extracted, and are early in a solid archive.
 *   - Its dump is taken exactly as the nightly one is, so it restores the same.
 *   - It talks to the same cluster install-services.ps1 provisioned.
 *
 * Source-level, like setup-path.test.ts: the Inno compiler exists only on
 * Windows, and what breaks here is a missing wire, not a wrong computation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (...path: string[]): string => readFileSync(join(process.cwd(), ...path), 'utf8');

const iss = read('packaging', 'windows', 'mehvar.iss');
const script = read('packaging', 'windows', 'pre-update-backup.ps1');
const installer = read('packaging', 'windows', 'install-services.ps1');
const backup = read('scripts', 'ops', 'backup.ts');

/** The body of one Pascal function in mehvar.iss. */
function pascalFunction(name: string): string {
  const start = iss.indexOf(`function ${name}(`);
  expect(start, `${name} is defined in mehvar.iss`).toBeGreaterThan(-1);
  const end = iss.indexOf('\nend;', start);
  return iss.slice(start, end);
}

describe('mehvar.iss backs up before it changes anything', () => {
  it('runs pre-update-backup.ps1 from PrepareToInstall — before [Files] is copied', () => {
    const prepare = pascalFunction('PrepareToInstall');
    expect(prepare).toContain("ExtractTemporaryFile('pre-update-backup.ps1')");
    expect(prepare).toContain("ExpandConstant('{tmp}\\pre-update-backup.ps1')");
  });

  it('extracts lib-verify.ps1 beside it, because the script dot-sources it', () => {
    expect(script).toMatch(/^\. \(Join-Path \$MyRoot 'lib-verify\.ps1'\)/m);
    expect(pascalFunction('PrepareToInstall')).toContain("ExtractTemporaryFile('lib-verify.ps1')");
  });

  it('stops Setup when the backup fails: a non-empty result is the refusal', () => {
    const prepare = pascalFunction('PrepareToInstall');
    expect(prepare).toMatch(/Result := '';/);
    expect(prepare).toMatch(/if ResultCode <> 0 then[\s\S]*Result :=/);
  });

  it('never installs the backup script, and lists both temporaries first (solid archive)', () => {
    const files = iss.slice(iss.indexOf('[Files]'), iss.indexOf('[Dirs]'));
    const sources = files.split('\n').filter((line) => line.startsWith('Source:'));
    expect(sources[0]).toMatch(/pre-update-backup\.ps1".*Flags: dontcopy/);
    expect(sources[1]).toMatch(/lib-verify\.ps1".*Flags: dontcopy/);
    expect(files.match(/pre-update-backup\.ps1/g)).toHaveLength(1);
  });
});

describe('the pre-update dump matches the nightly one', () => {
  it('uses exactly the pg_dump flags scripts/ops/backup.ts uses', () => {
    const nightly = /run\('pg_dump', \[([^\]]*)\]/.exec(backup)?.[1] ?? '';
    const flags = (text: string): string[] => text.match(/--[a-z-]+(?:=[a-z]+)?/g) ?? [];
    expect(flags(nightly)).toEqual(['--format=custom', '--no-owner', '--no-acl', '--file']);

    const pre = /Invoke-Native -FilePath \$pgDump -Arguments @\(([^)]*)\)/.exec(script)?.[1] ?? '';
    expect(flags(pre)).toEqual(flags(nightly));
  });

  it('names its file the way backupFileName does, so the drill recognises it', () => {
    // backupFileName: mehvar-<ISO UTC with : and . as ->.dump
    expect(script).toContain('ToUniversalTime().ToString("yyyy-MM-dd\'T\'HH-mm-ss-fff"');
    expect(script).toContain('"mehvar-$stamp.dump"');
  });

  it('keeps its dumps apart from the nightly retention window', () => {
    expect(script).toContain("Join-Path (Join-Path $DataDir 'backups') 'pre-update'");
  });
});

describe('it talks to the cluster install-services.ps1 provisioned', () => {
  for (const [name, pattern] of [
    ['PgPort', /\$PgPort\s*=\s*(\d+)/],
    ['DbName', /\$DbName\s*=\s*'([^']+)'/],
    ['DbOwner', /\$DbOwner\s*=\s*'([^']+)'/],
  ] as const) {
    it(`${name} agrees`, () => {
      const provisioned = pattern.exec(installer)?.[1];
      expect(provisioned).toBeDefined();
      expect(pattern.exec(script)?.[1]).toBe(provisioned);
    });
  }

  it('reads the owner password install-services.ps1 stashes', () => {
    expect(installer).toContain("Join-Path $DataDir '.pgpass-owner'");
    expect(script).toContain("Join-Path $DataDir '.pgpass-owner'");
  });
});
