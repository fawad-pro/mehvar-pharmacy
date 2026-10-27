/**
 * Which build of Mehvar this is — read from the payload's VERSION file.
 *
 * Every build used to call itself `0.0.0`, and the installer's own record said
 * `unknown` (init ran outside npm, so `npm_package_version` was never set), so
 * neither the support bundle nor the database could tell one release from the
 * next. `package:build` now stamps VERSION with the git commit; this is the one
 * reader, used by the server (licensing records it per installation), `init`
 * and the support bundle.
 *
 * VERSION sits at the install root; the bundled scripts live three levels down
 * in app/bin/<db|ops>/, so it is found relative to this module. In a checkout
 * there is no VERSION, and the build says so rather than pretending.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Release {
  /** package.json's version. */
  readonly version: string;
  /** `<version>+<commit>[.dirty]` — the identifier to quote to support. */
  readonly build: string;
  readonly commit: string | undefined;
  readonly builtAt: string | undefined;
}

export function parseRelease(raw: string): Release | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.version !== 'string') return undefined;
    const commit = typeof record.commit === 'string' ? record.commit : undefined;
    return {
      version: record.version,
      build: typeof record.build === 'string' ? record.build : record.version,
      commit,
      builtAt: typeof record.builtAt === 'string' ? record.builtAt : undefined,
    };
  } catch {
    return undefined;
  }
}

/** The installed build, or a plain statement that this is not one. */
export function currentRelease(
  versionFile: string = join(__dirname, '..', '..', '..', 'VERSION'),
): Release {
  try {
    const release = parseRelease(readFileSync(versionFile, 'utf8'));
    if (release !== undefined) return release;
  } catch {
    // Not a packaged build.
  }
  const version = process.env.npm_package_version ?? '0.0.0';
  return { version, build: `${version}+development`, commit: undefined, builtAt: undefined };
}
