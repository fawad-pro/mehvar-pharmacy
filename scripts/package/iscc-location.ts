/**
 * Finding the Inno Setup compiler.
 *
 * ISCC.exe is not on PATH after a default Inno Setup install, and the
 * directory carries the major version — `Inno Setup 7` today, `6` on machines
 * that have not upgraded, and a different Program Files root on 32-bit
 * installs of either. Hard-coding one path means the build breaks on the next
 * machine or the next upgrade, so the candidates are searched newest-first.
 *
 * Pure and parameterised so the search order can be tested from Linux, where
 * none of these paths exist. Same shape as `npm-command.ts`, for the same
 * reason: the last two round-trips were both platform assumptions that a test
 * on the developer's own OS could have caught.
 */

/** Newest first: a machine with both should build with the newer compiler. */
export const SUPPORTED_MAJORS = [7, 6, 5] as const;

export interface IsccSearchContext {
  env: Readonly<Record<string, string | undefined>>;
  /** Usually `existsSync`. Injected so the search order is testable. */
  exists: (path: string) => boolean;
}

/**
 * Every place ISCC.exe plausibly is, in the order it should be preferred.
 *
 * An explicit `ISCC` override comes first so a machine with a portable copy,
 * or a CI runner with its own layout, never has to argue with this list.
 */
export function isccCandidates(env: IsccSearchContext['env']): string[] {
  const candidates: string[] = [];

  const override = env.ISCC;
  if (override !== undefined && override.trim() !== '') {
    candidates.push(override.trim());
  }

  // Both roots, because a 32-bit Inno Setup on 64-bit Windows lands in the
  // (x86) tree and a 64-bit one does not.
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(
    (root): root is string => root !== undefined && root !== '',
  );

  // Deduplicated: on 32-bit Windows several of these are the same directory.
  const seen = new Set<string>();
  for (const major of SUPPORTED_MAJORS) {
    for (const root of roots) {
      const path = `${root}\\Inno Setup ${major}\\ISCC.exe`;
      if (!seen.has(path)) {
        seen.add(path);
        candidates.push(path);
      }
    }
  }

  return candidates;
}

export interface IsccResult {
  path: string | undefined;
  /** Everywhere that was looked, for an error message worth reading. */
  searched: string[];
}

export function findIscc(context: IsccSearchContext): IsccResult {
  const searched = isccCandidates(context.env);
  return { path: searched.find((candidate) => context.exists(candidate)), searched };
}
