/**
 * The static checks `lint:ps` runs everywhere, PowerShell installed or not —
 * split out of `lint-powershell.ts` so they can be tested without one, the same
 * shape as `powershell-findings.ts` and `migrations-location.ts`.
 *
 * Each encodes a specific mistake that already cost a Windows round-trip. They
 * read the script as text, so the ONE thing they must get right regardless of
 * where the checkout happened is line endings: a `.ps1` checked out on Windows
 * has CRLF, and a check that assumes LF produces false positives that only ever
 * appear on the machine the installer actually runs on. See `stripComments`.
 */

import type { Finding } from './powershell-findings';

export type { Finding };

/**
 * Blank out comments, keeping line numbers intact.
 *
 * Both kinds matter: `<# ... #>` blocks as well as `#` to end of line. The rules
 * below are documented in block comments that necessarily *mention* the thing
 * they forbid -- a checker that reads those as violations flags its own
 * explanation, which is how the first version of this file behaved.
 *
 * CRLF is normalised to LF FIRST, and this is not cosmetic. Without it,
 * `split('\n')` leaves a trailing `\r` on every line, and `#.*$` fails to strip
 * a `#` comment because `.` does not match `\r` and `$` will not anchor before
 * it -- so on a Windows checkout (CRLF, no .gitattributes forcing LF) the
 * comment survives, and a `$PSScriptRoot` MENTIONED in a comment inside a
 * param() block is reported as if it were used there. That false positive is
 * invisible on Linux and fires on exactly the platform the lint exists for.
 */
export function stripComments(source: string): string {
  const normalised = source.replace(/\r\n?/g, '\n');
  const withoutBlocks = normalised.replace(/<#[\s\S]*?#>/g, (match) =>
    // Preserve the newlines so reported line numbers stay true.
    '\n'.repeat((match.match(/\n/g) ?? []).length),
  );
  return withoutBlocks
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');
}

/** Splits a source into lines with CRLF normalised, for checks over raw text. */
function toLines(source: string): string[] {
  return source.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * `$PSScriptRoot` inside a `param(...)` block.
 *
 * Parameter defaults are evaluated during binding, where `$PSScriptRoot` can
 * be empty -- and `Join-Path` throws on an empty `-Path`, so the script dies
 * before its first line with an error naming `Join-Path` and nothing else.
 * This is exactly how `fetch-runtimes.ps1` failed on Windows.
 */
export function checkScriptRootInParamBlock(file: string, source: string): Finding[] {
  const lines = stripComments(source).split('\n');
  const findings: Finding[] = [];

  let depth = 0;
  let inParams = false;

  lines.forEach((line, index) => {
    const code = line;

    if (!inParams && /^\s*param\s*\(/i.test(code)) {
      inParams = true;
      depth = 0;
    }

    if (inParams) {
      if (/\$PSScriptRoot/i.test(code)) {
        findings.push({
          file,
          line: index + 1,
          message:
            '$PSScriptRoot in a param() block -- it can be empty during binding. ' +
            'Bind the parameter empty and resolve it in the body instead.',
        });
      }

      depth += (code.match(/\(/g) ?? []).length;
      depth -= (code.match(/\)/g) ?? []).length;
      if (depth <= 0 && /\)/.test(code)) inParams = false;
    }
  });

  return findings;
}

/**
 * `Join-Path $env:SOMETHING` without a null guard.
 *
 * `Join-Path` throws on a null or empty `-Path`, and environment variables are
 * not guaranteed: `LOCALAPPDATA` and `TEMP` are unset for some service
 * accounts, and none of them exist off Windows.
 *
 * Guard the variable, or use an API that cannot return null
 * (`[System.IO.Path]::GetTempPath()`, `[Environment]::GetFolderPath(...)`).
 */
export function checkUnguardedEnvPaths(file: string, source: string): Finding[] {
  const findings: Finding[] = [];

  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      const match = /Join-Path\s+\$env:(\w+)/i.exec(line);
      if (match === null) return;

      findings.push({
        file,
        line: index + 1,
        message:
          `Join-Path over $env:${match[1] ?? ''} -- Join-Path throws when the variable ` +
          'is unset. Guard it, or use an API that cannot return null.',
      });
    });

  return findings;
}

/**
 * No non-ASCII bytes in a `.ps1`.
 *
 * Windows PowerShell 5.1 decodes a `.ps1` with no byte-order mark using the
 * system ANSI code page, NOT UTF-8. An em dash written as UTF-8 `E2 80 94`
 * arrives as three ANSI characters, the last of which is U+201D; PowerShell
 * accepts curly quotes as string delimiters, so a dash inside a double-quoted
 * string CLOSES THE STRING and the file fails to parse. ASCII-only is the fix
 * that needs no BOM handling and cannot regress. (`\r` is ASCII, so CRLF is not
 * flagged here -- normalising it out first keeps column numbers honest anyway.)
 */
export function checkAsciiOnly(file: string, source: string): Finding[] {
  const findings: Finding[] = [];

  toLines(source).forEach((line, index) => {
    const match = /[^\x00-\x7F]/.exec(line);
    if (match === null) return;

    const char = match[0] ?? '';
    findings.push({
      file,
      line: index + 1,
      message:
        `non-ASCII character ${JSON.stringify(char)} (U+${(char.codePointAt(0) ?? 0)
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')}) at column ${match.index + 1}. ` +
        'Windows PowerShell 5.1 reads .ps1 as ANSI, which can turn this into a ' +
        'string delimiter and stop the whole file parsing. Use ASCII.',
    });
  });

  return findings;
}

/**
 * Registering the counter service without WinSW.
 *
 * `sc.exe create ... binPath=` fails with 1639 (PowerShell re-serialises the
 * argument array into a command line sc.exe cannot re-parse), and `New-Service`
 * produces a service that cannot start (1053 -- node never answers the SCM).
 * WinSW is service-aware and runs node as a supervised child.
 */
export function checkScCreate(file: string, source: string): Finding[] {
  const findings: Finding[] = [];

  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      const scCreate =
        /\bsc(?:\.exe)?\b/i.test(line) &&
        /\b(create|config)\b/i.test(line) &&
        /binPath\s*=/i.test(line);
      const newService = /\bNew-Service\b/i.test(line);

      if (!scCreate && !newService) return;

      findings.push({
        file,
        line: index + 1,
        message: scCreate
          ? 'sc.exe create/config with binPath= -- PowerShell re-serialises the ' +
            'value into a command line sc.exe cannot parse (exit 1639), and the ' +
            'resulting service could not start anyway (1053). WinSW registers ' +
            'the service: MehvarNode.exe install.'
          : 'New-Service registers node.exe as a service directly, which cannot ' +
            'start: a service image must answer the SCM within ~30s and node ' +
            'never does (1053). WinSW hosts it instead: MehvarNode.exe install.',
      });
    });

  return findings;
}

/**
 * Block comments must be closed.
 *
 * An unterminated `<#` swallows the rest of the file, and PowerShell reports it
 * as a syntax error at the last line -- nowhere near the cause.
 */
export function checkBlockComments(file: string, source: string): Finding[] {
  const opens = (source.match(/<#/g) ?? []).length;
  const closes = (source.match(/#>/g) ?? []).length;
  if (opens === closes) return [];

  return [
    {
      file,
      line: 1,
      message: `${opens} block comment(s) opened with <# but ${closes} closed with #>.`,
    },
  ];
}
