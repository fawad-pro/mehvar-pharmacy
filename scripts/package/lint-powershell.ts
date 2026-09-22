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

import { parsePowerShellFindings, type Finding } from './powershell-findings';
import {
  checkAsciiOnly,
  checkBlockComments,
  checkScCreate,
  checkScriptRootInParamBlock,
  checkUnguardedEnvPaths,
} from './ps-static-checks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptDir = join(root, 'packaging', 'windows');

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
    # No -AsArray: it is a PowerShell 6+ switch, and the installer runs on
    # Windows PowerShell 5.1, which rejects it outright ("A parameter cannot be
    # found that matches parameter name 'AsArray'") and takes the whole lint
    # step down with it. The count-dependent shape this produces (a bare object
    # for a single finding) is normalised in parsePowerShellFindings so a lone
    # parse error is never dropped.
    $results | ConvertTo-Json -Compress
  `;

  const output = execFileSync(shell, ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });

  return parsePowerShellFindings(output);
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

/** The sibling `.ps1` files a script dot-sources at run time. */
function dotSourcedLibraries(source: string): string[] {
  return [...source.matchAll(/^\s*\.\s+\(Join-Path \$\w+ '([^']+\.ps1)'\)/gm)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * A dot-sourced library must be installed alongside the script that sources it.
 *
 * `verify-install.ps1` sources `lib-verify.ps1`; `install-services.ps1` sources
 * `lib-service.ps1`. Ship the sourcing script without its library and the whole
 * step dies at its first line — a failure identical in shape to the parse error
 * that produced no log at all, and equally invisible until an install.
 *
 * Only scripts `mehvar.iss` actually installs are checked, so a dev-only suite
 * that sources a library is not required to be shipped.
 */
function checkDotSourcedLibrariesAreShipped(issSource: string, scriptSources: Map<string, string>) {
  const shipped = new Set(
    [...issSource.matchAll(/Source:\s*"\{#ScriptsDir\}([^"]+\.ps1)"/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined),
  );

  const findings: Finding[] = [];
  for (const name of shipped) {
    const source = scriptSources.get(name);
    if (source === undefined) continue;

    for (const library of dotSourcedLibraries(source)) {
      if (shipped.has(library)) continue;
      findings.push({
        file: 'mehvar.iss',
        line: 1,
        message:
          `[Files] installs ${name}, which dot-sources ${library} — but ${library} is ` +
          'not installed. The script would fail at its first line, on the shop machine only.',
      });
    }
  }
  return findings;
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
  const sources = new Map<string, string>();
  for (const name of files) {
    const source = readFileSync(join(scriptDir, name), 'utf8');
    sources.set(name, source);
    findings.push(...checkAsciiOnly(name, source));
    findings.push(...checkScriptRootInParamBlock(name, source));
    findings.push(...checkUnguardedEnvPaths(name, source));
    findings.push(...checkScCreate(name, source));
    findings.push(...checkBlockComments(name, source));
  }

  const issName = 'mehvar.iss';
  const issPath = join(scriptDir, issName);
  if (existsSync(issPath)) {
    const issSource = readFileSync(issPath, 'utf8');
    const wrappers = installedWrappers(
      readFileSync(join(scriptDir, 'install-services.ps1'), 'utf8'),
    );
    findings.push(...checkInnoSetupScript(issName, issSource, wrappers));
    findings.push(...checkDotSourcedLibrariesAreShipped(issSource, sources));
  }

  const shell = findPowerShell();

  if (shell !== undefined) {
    /*
     * The behavioural suites, RUN rather than merely parsed. Each exists
     * because the thing it pins failed on real hardware and no static check
     * could have seen it:
     *
     *   service-descriptor  sc.exe exit 1639 — a malformed argument string.
     *   verify-checks       a passing ADR-1 guarantee reported as a failure,
     *                       because $ErrorActionPreference = 'Stop' turned
     *                       psql's own diagnostics into a terminating error
     *                       before the exit code could be read.
     */
    for (const name of ['service-descriptor.tests.ps1', 'verify-checks.tests.ps1']) {
      const suite = join(scriptDir, name);
      if (!existsSync(suite)) continue;
      try {
        execFileSync(shell, ['-NoProfile', '-File', suite], { stdio: 'inherit' });
      } catch {
        findings.push({ file: name, line: 1, message: 'assertions FAILED (output above).' });
      }
    }
  }

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
