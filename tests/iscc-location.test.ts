/**
 * Where the Inno Setup compiler is looked for.
 *
 * ISCC.exe is not on PATH after a default install and its directory carries
 * the major version, so "it worked on my machine" is exactly the failure mode
 * this search order exists to avoid. Testable from Linux because the paths and
 * the existence check are both injected.
 */

import { describe, expect, it } from 'vitest';

import { findIscc, isccCandidates, SUPPORTED_MAJORS } from '../scripts/package/iscc-location';

const WINDOWS_ENV = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
};

/** Pretend only these paths exist. */
function only(...present: string[]): (path: string) => boolean {
  return (path) => present.includes(path);
}

describe('candidate paths', () => {
  it('finds the compiler where Inno Setup 7 actually installs it', () => {
    const expected = 'C:\\Program Files\\Inno Setup 7\\ISCC.exe';

    expect(findIscc({ env: WINDOWS_ENV, exists: only(expected) }).path).toBe(expected);
  });

  it('prefers a newer Inno Setup when several are installed', () => {
    const seven = 'C:\\Program Files\\Inno Setup 7\\ISCC.exe';
    const six = 'C:\\Program Files\\Inno Setup 6\\ISCC.exe';

    expect(findIscc({ env: WINDOWS_ENV, exists: only(six, seven) }).path).toBe(seven);
  });

  it('looks in the (x86) root, where a 32-bit Inno Setup lands', () => {
    const x86 = 'C:\\Program Files (x86)\\Inno Setup 7\\ISCC.exe';

    expect(findIscc({ env: WINDOWS_ENV, exists: only(x86) }).path).toBe(x86);
  });

  it('covers every supported major version', () => {
    const candidates = isccCandidates(WINDOWS_ENV);

    for (const major of SUPPORTED_MAJORS) {
      expect(candidates).toContain(`C:\\Program Files\\Inno Setup ${major}\\ISCC.exe`);
    }
  });

  it('never lists the same directory twice on 32-bit Windows', () => {
    // There, ProgramFiles and ProgramFiles(x86) are the same path.
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files' };
    const candidates = isccCandidates(env);

    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe('the ISCC override', () => {
  it('wins over every discovered path', () => {
    const portable = 'D:\\Tools\\InnoSetup\\ISCC.exe';
    const installed = 'C:\\Program Files\\Inno Setup 7\\ISCC.exe';

    const result = findIscc({
      env: { ...WINDOWS_ENV, ISCC: portable },
      exists: only(portable, installed),
    });

    expect(result.path).toBe(portable);
  });

  it('is ignored when blank, rather than searched for as an empty path', () => {
    const installed = 'C:\\Program Files\\Inno Setup 7\\ISCC.exe';

    expect(findIscc({ env: { ...WINDOWS_ENV, ISCC: '   ' }, exists: only(installed) }).path).toBe(
      installed,
    );
  });
});

describe('when nothing is found', () => {
  it('reports every path it looked at, so the message is actionable', () => {
    const result = findIscc({ env: WINDOWS_ENV, exists: () => false });

    expect(result.path).toBeUndefined();
    expect(result.searched.length).toBeGreaterThanOrEqual(SUPPORTED_MAJORS.length);
    expect(result.searched).toContain('C:\\Program Files\\Inno Setup 7\\ISCC.exe');
  });

  it('does not crash when the environment has no Program Files at all', () => {
    expect(() => findIscc({ env: {}, exists: () => false })).not.toThrow();
  });
});
