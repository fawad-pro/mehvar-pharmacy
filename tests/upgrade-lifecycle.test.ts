/**
 * The Windows upgrade lifecycle — order and independence from first-run.txt.
 *
 * The upgrade test found three ways an update broke a working shop:
 *
 *   1. Setup replaced node.exe, MehvarNode.exe and the PostgreSQL binaries
 *      under running services (Windows refuses to overwrite a running image),
 *      and migrated the schema beneath the still-running old application.
 *   2. Step 9 demanded first-run.txt — a file holding the owner password in
 *      plain text that a careful shop deletes — so every later update reported
 *      "the pharmacy was not created", after migrating.
 *   3. The wizard asked for the shop name and a PIN again, and init.js then
 *      validated them before noticing a pharmacy already existed.
 *
 * Stop-MehvarServices' decisions are pinned by services.tests.ps1 (lint:ps).
 * This pins the wiring across files, which no single script can see.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (...path: string[]): string => readFileSync(join(process.cwd(), ...path), 'utf8');

const iss = read('packaging', 'windows', 'mehvar.iss');
const installer = read('packaging', 'windows', 'install-services.ps1');
const init = read('scripts', 'db', 'init.ts');

function pascal(kind: 'function' | 'procedure', name: string): string {
  const start = iss.indexOf(`${kind} ${name}(`);
  expect(start, `${name} is defined in mehvar.iss`).toBeGreaterThan(-1);
  return iss.slice(start, iss.indexOf('\nend;', start));
}

describe('Setup stops the services before it replaces anything', () => {
  const prepare = pascal('function', 'PrepareToInstall');

  it('backs up first, then stops the services, all inside PrepareToInstall', () => {
    const backup = prepare.indexOf('pre-update-backup.ps1');
    const stop = prepare.indexOf("ExpandConstant('{tmp}\\stop-services.ps1')");
    expect(backup).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(backup);
  });

  it('never stops the services when the backup failed', () => {
    const failed = prepare.indexOf('PRE-UPDATE BACKUP FAILED');
    const exit = prepare.indexOf('Exit;', failed);
    expect(exit).toBeGreaterThan(failed);
    expect(exit).toBeLessThan(prepare.indexOf("ExtractTemporaryFile('stop-services.ps1')"));
  });

  it('refuses to continue when a service will not stop', () => {
    expect(prepare).toMatch(/STOPPING SERVICES FAILED[\s\S]*Result :=/);
    expect(prepare.indexOf('ServicesStopped := True')).toBeGreaterThan(
      prepare.indexOf('STOPPING SERVICES FAILED'),
    );
  });

  it('extracts stop-services.ps1 with the library it dot-sources', () => {
    const script = read('packaging', 'windows', 'stop-services.ps1');
    expect(script).toMatch(/^\. \(Join-Path \$MyRoot 'lib-service\.ps1'\)/m);
    expect(prepare).toContain("ExtractTemporaryFile('lib-service.ps1')");
    const files = iss.slice(iss.indexOf('[Files]'), iss.indexOf('[InstallDelete]'));
    const head = files
      .split('\n')
      .filter((line) => line.startsWith('Source:'))
      .slice(0, 4);
    expect(head.join('\n')).toMatch(/stop-services\.ps1".*dontcopy/);
    expect(head.join('\n')).toMatch(/lib-service\.ps1".*DestDir: "\{tmp\}".*dontcopy/);
  });

  it('starts them again if Setup ends before install-services.ps1 runs', () => {
    const deinit = pascal('procedure', 'DeinitializeSetup');
    expect(deinit).toContain('ServicesStopped and not PostInstallStarted');
    expect(deinit).toContain('start MehvarPostgres');
    expect(deinit).toContain('start MehvarNode');
    expect(pascal('procedure', 'CurStepChanged')).toContain('PostInstallStarted := True');
  });

  it('install-services.ps1 stops the application again before it migrates', () => {
    const stop = installer.indexOf('Stop-MehvarServices -Names @($AppService)');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(installer.indexOf("Join-Path $BinDir 'db\\migrate.js'"));
  });
});

describe('an update never depends on first-run.txt', () => {
  it('step 9 proves the pharmacy from the database, not from the plaintext file', () => {
    const step9 = installer.slice(installer.indexOf("Write-Step 'Confirming the install'"));
    expect(step9).toContain('SELECT count(*) FROM tenants');
    expect(step9).not.toMatch(/throw[^\n]*first-run/);
  });

  it('nothing recreates it: only init.js writes it, and only for a new pharmacy', () => {
    const existingCheck = init.indexOf('const existing = await listTenantIds()');
    const write = init.indexOf("join(installationDir(), 'first-run.txt')");
    expect(existingCheck).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(existingCheck);
    expect(installer).not.toMatch(/Set-Content[^\n]*first-run/);
  });
});

describe('an upgrade keeps the shop identity and owner PIN', () => {
  it('skips the shop and PIN pages when a pharmacy already exists', () => {
    const skip = pascal('function', 'ShouldSkipPage');
    expect(skip).toContain('ExistingPharmacy');
    expect(skip).toContain('ShopPage.ID');
    expect(skip).toContain('PinPage.ID');
    expect(pascal('function', 'IsExistingPharmacy')).toContain('installation.json');
  });

  it('install-services.ps1 accepts the empty values a skipped page leaves', () => {
    expect(installer).not.toMatch(/\[Parameter\(Mandatory\)\]\s*\[string\]\s*\$ShopName/);
    expect(installer).not.toMatch(/\[Parameter\(Mandatory\)\]\s*\[string\]\s*\$OwnerPin/);
  });

  it('init.js decides "a pharmacy exists" before it reads the wizard values', () => {
    expect(init.indexOf('const existing = await listTenantIds()')).toBeLessThan(
      init.indexOf('const input = readInput(process.env)'),
    );
  });
});
