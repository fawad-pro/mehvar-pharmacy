/**
 * Parsing the JSON that `[Parser]::ParseFile` errors are serialised into.
 *
 * Split out of `lint-powershell.ts` so it can be tested without a PowerShell on
 * the machine — the same shape as `migrations-location.ts` — because the thing
 * that broke is a property of the SERIALISATION, not of the parser.
 *
 * ## Why this exists (the Windows PowerShell 5.1 bug)
 *
 * The lint step serialised its findings with `ConvertTo-Json -Compress -AsArray`.
 * `-AsArray` was introduced in PowerShell 6 (`pwsh`); Windows PowerShell 5.1 —
 * which is `powershell.exe`, the runtime the installer actually uses — does not
 * have it, so the whole step died with:
 *
 *     ConvertTo-Json : A parameter cannot be found that matches parameter name 'AsArray'.
 *
 * `-AsArray` was doing real work, though: it forced array output even for zero
 * or one element. WITHOUT it, both 5.1 and `pwsh` serialise the count-dependent
 * shape ConvertTo-Json has always produced:
 *
 *   - **0 findings**  -> empty output (nothing written)
 *   - **1 finding**   -> a bare object, `{"file":...}` — NOT `[{...}]`
 *   - **N findings**  -> an array, `[{...},{...}]`
 *
 * So the fix cannot simply drop `-AsArray`: the previous code did
 * `if (!Array.isArray(parsed)) return []`, which would silently DISCARD a lone
 * parse error — weakening the very assertion the lint exists to make. This
 * function normalises all three shapes, so a single finding is surfaced exactly
 * like one of many.
 */

export interface Finding {
  file: string;
  line: number;
  message: string;
}

/**
 * Turns ConvertTo-Json output into findings, tolerant of the count-dependent
 * shape 5.1 emits without `-AsArray`.
 *
 * Malformed rows (missing `file`/`message`) are dropped rather than thrown on:
 * the caller has already run the parser, and a row it cannot read is not a
 * reason to crash the lint. Genuinely invalid JSON still throws — that is a
 * broken PowerShell invocation, not a finding to swallow.
 */
export function parsePowerShellFindings(output: string): Finding[] {
  const trimmed = output.trim();
  // Zero findings: empty output from the pipeline, or an explicit empty array.
  if (trimmed === '' || trimmed === '[]') {
    return [];
  }

  const parsed: unknown = JSON.parse(trimmed);

  // The heart of the fix: a single finding arrives as a bare object under
  // Windows PowerShell 5.1 (and under pwsh without -AsArray). Wrap it so it is
  // read exactly like one element of an array, never dropped.
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

  return rows.flatMap((entry): Finding[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.file !== 'string' || typeof row.message !== 'string') {
      return [];
    }
    return [{ file: row.file, line: Number(row.line ?? 1), message: row.message }];
  });
}
