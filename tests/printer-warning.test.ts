/**
 * The installer warns when receipts would not reach a receipt printer.
 *
 * The counter prints with Chrome's --kiosk-printing, which sends every receipt
 * to the Windows default printer without a dialog. On a laptop whose default
 * was "Microsoft Print to PDF", every receipt became a downloaded PDF and
 * nothing said why. verify-install.ps1 now checks the default printer and exits
 * 2 ("passed, with something to fix"); mehvar.iss shows the warning without
 * marking the install unverified.
 *
 * The rule itself (which printer names warn) is pinned by
 * verify-checks.tests.ps1 under lint:ps. This pins the wiring across the two
 * files, which neither script can see.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (...path: string[]): string => readFileSync(join(process.cwd(), ...path), 'utf8');

const verify = read('packaging', 'windows', 'verify-install.ps1');
const iss = read('packaging', 'windows', 'mehvar.iss');

describe('the default-printer warning', () => {
  it('is checked only after every real check passed, and exits 2 rather than 1', () => {
    const failedExit = verify.indexOf('exit 1');
    const warning = verify.indexOf('Get-DefaultPrinterWarning');
    expect(failedExit).toBeGreaterThan(-1);
    expect(warning).toBeGreaterThan(failedExit);
    expect(verify.slice(warning)).toMatch(/exit 2/);
  });

  it('is shown by Setup as a warning, before any non-zero code is treated as a failure', () => {
    const warned = iss.indexOf('if ResultCode = 2 then');
    const failed = iss.indexOf('else if ResultCode <> 0 then');
    expect(warned).toBeGreaterThan(-1);
    // Order is the point: tested the other way round, 2 would read as a failed
    // install and the founder would be told not to hand the machine over.
    expect(failed).toBeGreaterThan(warned);
    expect(iss.slice(warned, failed)).not.toContain('ChecksOk := False');
  });
});
