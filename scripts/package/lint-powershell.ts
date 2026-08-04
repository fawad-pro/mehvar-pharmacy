/**
 * `npm run lint:ps` — check the Windows packaging scripts.
 *
 * Nothing in the toolchain looked at `packaging/windows/*.ps1` at all: no
 * parser, no linter, no test. They were authored on Linux, and the first thing
 * to read them critically was a Windows machine at the far end of a
 * round-trip. Two of the bugs that cost round-trips were mechanically
 * detectable from a checkout.
 *
 * Two levels, deliberately:
 *
 *   1. **Static checks**, which run everywhere including CI on Linux. They
 *      encode the specific mistakes already made, so those cannot come back.
 *   2. **A full parse**, when PowerShell is installed. Skipped with a warning
 *      otherwise — the same posture `db:grants` takes without `APP_DB_ROLE`,
 *      and the same caveat applies: skipping is not passing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptDir = join(root, 'packaging', 'windows');

interface Finding {
  file: string;
  line: number;
  message: string;
}

/**
 * Blank out comments, keeping line numbers intact.
 *
 * Both kinds matter: `<# … #>` blocks as well as `#` to end of line. The rules
 * below are documented in block comments that necessarily *mention* the thing
 * they forbid — a checker that reads those as violations flags its own
 * explanation, which is how the first version of this file behaved.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/<#[\s\S]*?#>/g, (match) =>
    // Preserve the newlines so reported line numbers stay true.
    '\n'.repeat((match.match(/\n/g) ?? []).length),
  );
  return withoutBlocks
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');
}

/**
 * `$PSScriptRoot` inside a `param(...)` block.
 *
 * Parameter defaults are evaluated during binding, where `$PSScriptRoot` can
 * be empty — and `Join-Path` throws on an empty `-Path`, so the script dies
 * before its first line with an error naming `Join-Path` and nothing else.
 * This is exactly how `fetch-runtimes.ps1` failed on Windows.
 */
function checkScriptRootInParamBlock(file: string, source: string): Finding[] {
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
            '$PSScriptRoot in a param() block — it can be empty during binding. ' +
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
 * Block comments must be closed.
 *
 * An unterminated `<#` swallows the rest of the file, and PowerShell reports it
 * as a syntax error at the last line — nowhere near the cause.
 */
function checkBlockComments(file: string, source: string): Finding[] {
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

/** PowerShell, if this machine has it. `pwsh` is Core; `powershell` is 5.1. */
function findPowerShell(): string | undefined {
  for (const candidate of ['pwsh', 'powershell']) {
    try {
      execFileSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
        stdio: 'ignore',
      });
      return candidate;
    } catch {
      // Not installed, or not on PATH. Try the next one.
    }
  }
  return undefined;
}

function parseWithPowerShell(shell: string, files: string[]): Finding[] {
  const script = `
    $ErrorActionPreference = 'Stop'
    $results = @()
    foreach ($path in @(${files.map((file) => `'${file.replace(/'/g, "''")}'`).join(',')})) {
      $errors = $null
      [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors)
      foreach ($e in $errors) {
        $results += [pscustomobject]@{
          file = $path
          line = $e.Extent.StartLineNumber
          message = $e.Message
        }
      }
    }
    $results | ConvertTo-Json -Compress -AsArray
  `;

  const output = execFileSync(shell, ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  }).trim();

  if (output === '' || output === '[]') return [];

  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): Finding[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.file !== 'string' || typeof row.message !== 'string') return [];
    return [{ file: row.file, line: Number(row.line ?? 1), message: row.message }];
  });
}

/**
 * Cross-file consistency for `mehvar.iss`.
 *
 * The Inno Setup script cannot be compiled outside Windows, so nothing here
 * reads it at all. These are the mistakes that have actually happened: a
 * `[Icons]` entry pointing at a file nothing creates, and `[UninstallDelete]`
 * still naming `{app}\bin` after the compiled scripts moved inside `app\`.
 *
 * Deliberately shallow. This is not a parser and should not grow into one —
 * the compiler on the Windows box is the real check.
 */
function checkInnoSetupScript(file: string, source: string, wrapperNames: string[]): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    if (line.trimStart().startsWith(';')) return;

    // Paths under {app} that Setup neither installs nor is told to create.
    const target = /Filename:\s*"\{app\}\\([^"\\]+\.cmd)"/i.exec(line);
    if (target !== null) {
      const name = target[1];
      if (name !== undefined && !wrapperNames.includes(name)) {
        findings.push({
          file,
          line: index + 1,
          message:
            `[Icons] points at {app}\\${name}, which install-services.ps1 does not write. ` +
            'The shortcut would dangle.',
        });
      }
    }

    // `bin\` moved inside `app\`; a bare {app}\bin is left over from before.
    if (/Name:\s*"\{app\}\\bin"/i.test(line)) {
      findings.push({
        file,
        line: index + 1,
        message: '{app}\\bin no longer exists — the compiled scripts live in {app}\\app\\bin.',
      });
    }
  });

  return findings;
}

/** The `.cmd` files install-services.ps1 writes into the install root. */
function installedWrappers(source: string): string[] {
  return [...source.matchAll(/Join-Path \$InstallDir '([^']+\.cmd)'/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

function main(): void {
  const files = readdirSync(scriptDir)
    .filter((name) => name.endsWith('.ps1'))
    .sort();

  if (files.length === 0) {
    console.log('No PowerShell scripts to check.');
    return;
  }

  const findings: Finding[] = [];
  for (const name of files) {
    const source = readFileSync(join(scriptDir, name), 'utf8');
    findings.push(...checkScriptRootInParamBlock(name, source));
    findings.push(...checkBlockComments(name, source));
  }

  const issName = 'mehvar.iss';
  const issPath = join(scriptDir, issName);
  if (existsSync(issPath)) {
    const wrappers = installedWrappers(
      readFileSync(join(scriptDir, 'install-services.ps1'), 'utf8'),
    );
    findings.push(...checkInnoSetupScript(issName, readFileSync(issPath, 'utf8'), wrappers));
  }

  const shell = findPowerShell();
  if (shell === undefined) {
    console.log(
      'PowerShell is not installed — syntax parsing SKIPPED.\n' +
        'Static checks ran, but skipping is not passing: a syntax error would\n' +
        'not be caught here. Install PowerShell, or rely on the Windows build.',
    );
  } else {
    findings.push(
      ...parseWithPowerShell(
        shell,
        files.map((name) => join(scriptDir, name)),
      ),
    );
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}  ${finding.message}`);
    }
    console.error(`\n${findings.length} problem(s) in packaging/windows.`);
    process.exit(1);
  }

  console.log(
    `${files.length} PowerShell script(s) + mehvar.iss checked` +
      (shell === undefined ? ' (static only).' : `, PowerShell parsed with ${shell}.`),
  );
}

main();
