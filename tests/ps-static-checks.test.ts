/**
 * Regression for the CRLF false positive in `lint:ps`'s $PSScriptRoot check.
 *
 * `checkScriptRootInParamBlock` strips comments before looking for the pattern,
 * so a `$PSScriptRoot` MENTIONED in a comment inside a param() block (which is
 * exactly how counter-shortcut.ps1 and uninstall-services.ps1 document the rule
 * they follow) must not be flagged.
 *
 * That held on Linux and broke on Windows: `.ps1` checks out with CRLF (no
 * .gitattributes forces LF), `split('\n')` leaves a trailing `\r`, and `#.*$`
 * fails to strip the comment because `.` does not match `\r`. So the comment
 * survived and the mention was reported — a false positive that appeared only
 * on the platform the installer runs on. `stripComments` now normalises CRLF
 * first; these pin that both endings behave identically, and that a REAL
 * `$PSScriptRoot` default is still caught under either.
 */

import { describe, expect, it } from 'vitest';

import {
  checkScriptRootInParamBlock,
  stripComments,
} from '../scripts/package/ps-static-checks';

const crlf = (source: string): string => source.replace(/\n/g, '\r\n');

/** The shape of uninstall-services.ps1 / counter-shortcut.ps1: mention in a comment. */
const COMMENTED = [
  'param(',
  '    # Not a $PSScriptRoot expression -- resolved in the body instead.',
  '    [string] $InstallDir',
  ')',
  '$root = $PSScriptRoot',
  '',
].join('\n');

/** The real bug the check exists to catch: dereferenced in a param default. */
const REAL_BUG = [
  'param(',
  '    [string] $InstallDir = (Join-Path $PSScriptRoot ".."),',
  '    [switch] $Force',
  ')',
  '',
].join('\n');

describe('stripComments', () => {
  it('strips a # comment regardless of line ending', () => {
    for (const source of ['  # $PSScriptRoot here\ncode\n', crlf('  # $PSScriptRoot here\ncode\n')]) {
      expect(stripComments(source)).not.toMatch(/\$PSScriptRoot/);
    }
  });
});

describe('checkScriptRootInParamBlock', () => {
  it('does not flag a $PSScriptRoot mentioned in a comment (LF)', () => {
    expect(checkScriptRootInParamBlock('uninstall-services.ps1', COMMENTED)).toEqual([]);
  });

  it('does not flag a $PSScriptRoot mentioned in a comment (CRLF, the Windows case)', () => {
    // This is the exact regression: on a CRLF checkout the comment survived
    // stripping and the mention was reported at the comment line.
    expect(checkScriptRootInParamBlock('uninstall-services.ps1', crlf(COMMENTED))).toEqual([]);
  });

  it('flags a real $PSScriptRoot in a param default (LF)', () => {
    const findings = checkScriptRootInParamBlock('bad.ps1', REAL_BUG);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
  });

  it('flags a real $PSScriptRoot in a param default (CRLF) — the check still works', () => {
    const findings = checkScriptRootInParamBlock('bad.ps1', crlf(REAL_BUG));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
  });
});
