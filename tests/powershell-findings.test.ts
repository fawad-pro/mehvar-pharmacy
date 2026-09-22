/**
 * Regression for the Windows PowerShell 5.1 incompatibility in `lint:ps`.
 *
 * The lint serialised parse errors with `ConvertTo-Json -Compress -AsArray`.
 * `-AsArray` is a PowerShell 6+ switch; Windows PowerShell 5.1 (the runtime the
 * installer runs) rejects it and the whole step dies with "A parameter cannot
 * be found that matches parameter name 'AsArray'".
 *
 * Dropping `-AsArray` is only half the fix: without it, ConvertTo-Json emits a
 * count-dependent shape, and a SINGLE finding comes back as a bare object rather
 * than a one-element array. The previous code did `if (!Array.isArray) return []`,
 * which would silently discard that lone parse error — weakening the assertion.
 *
 * These pin every shape a real PowerShell produces (each was verified against
 * pwsh 7 with `ConvertTo-Json -Compress`, which serialises identically to 5.1):
 * zero findings, one finding (the bare object — the case that regressed), and
 * many.
 */

import { describe, expect, it } from 'vitest';

import { parsePowerShellFindings } from '../scripts/package/powershell-findings';

describe('parsePowerShellFindings', () => {
  it('returns nothing for zero findings (empty pipeline output)', () => {
    expect(parsePowerShellFindings('')).toEqual([]);
    expect(parsePowerShellFindings('   \n  ')).toEqual([]);
    expect(parsePowerShellFindings('[]')).toEqual([]);
  });

  it('surfaces a SINGLE finding serialised as a bare object (the 5.1 shape)', () => {
    // Exactly what `$oneItemArray | ConvertTo-Json -Compress` emits without
    // -AsArray, on both Windows PowerShell 5.1 and pwsh.
    const output = '{"file":"fetch-runtimes.ps1","line":12,"message":"Unexpected token"}';

    const findings = parsePowerShellFindings(output);

    expect(findings).toEqual([
      { file: 'fetch-runtimes.ps1', line: 12, message: 'Unexpected token' },
    ]);
  });

  it('surfaces every finding when many are serialised as an array', () => {
    const output =
      '[{"file":"a.ps1","line":3,"message":"one"},{"file":"b.ps1","line":9,"message":"two"}]';

    expect(parsePowerShellFindings(output)).toEqual([
      { file: 'a.ps1', line: 3, message: 'one' },
      { file: 'b.ps1', line: 9, message: 'two' },
    ]);
  });

  it('defaults a missing line to 1 rather than NaN', () => {
    const output = '{"file":"x.ps1","message":"no line number"}';
    expect(parsePowerShellFindings(output)).toEqual([
      { file: 'x.ps1', line: 1, message: 'no line number' },
    ]);
  });

  it('drops rows that are not readable findings, without throwing', () => {
    // A stray value and an object missing the required fields are ignored; the
    // one good row still comes through.
    const output = '[42,{"line":5},{"file":"ok.ps1","line":2,"message":"kept"}]';
    expect(parsePowerShellFindings(output)).toEqual([
      { file: 'ok.ps1', line: 2, message: 'kept' },
    ]);
  });
});
