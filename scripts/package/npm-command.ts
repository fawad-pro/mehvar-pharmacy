/**
 * How to invoke npm, on whatever machine the packager is running on.
 *
 * This exists because getting it wrong is silent on the developer's OS and
 * fatal on the customer's. Two facts have to hold at once:
 *
 *  1. **On Windows npm is `npm.cmd`, not `npm`.** `execFileSync('npm', …)`
 *     performs no PATHEXT resolution, so it looks for a literal file called
 *     `npm`, finds nothing, and fails with ENOENT. On Linux and macOS the very
 *     same call is correct, which is why this shipped green from a Linux
 *     checkout and died on the first real Windows run.
 *
 *  2. **A `.cmd` cannot be spawned without a shell on modern Node.** Since the
 *     CVE-2024-27980 fix (Node ≥18.20.2 / 20.12.2 / 21.7.3 — this repo is on
 *     22.x), `spawn`/`execFile` on a `.bat` or `.cmd` throws `EINVAL` unless
 *     `shell: true`. So "just use npm.cmd" trades one Windows failure for
 *     another.
 *
 * The way out of both is to avoid the shim entirely when we can: npm sets
 * `npm_execpath` to its own CLI **JavaScript** file for every script it runs,
 * and that can be handed straight to the Node binary already executing this
 * code. No shell, no `.cmd`, no PATH lookup, identical on every platform — and
 * it runs the same npm that invoked us rather than whichever is first on PATH.
 *
 * The fallback covers someone running the packager directly.
 */

/** A spawn target: what to execute, with which arguments, and whether via a shell. */
export interface Invocation {
  command: string;
  args: string[];
  /**
   * Required for `.cmd` on Node ≥18.20.2 (see fact 2 above), and deliberately
   * false everywhere else — a shell adds a quoting layer that argument arrays
   * exist to avoid.
   */
  shell: boolean;
}

export interface NpmContext {
  /** `process.platform`. */
  platform: string;
  /** `process.env`. */
  env: Readonly<Record<string, string | undefined>>;
  /** `process.execPath` — the Node binary currently running. */
  nodePath: string;
}

/** npm's CLI is JavaScript; a `.cmd` in this variable is the shim, not the CLI. */
function isJavaScript(path: string): boolean {
  return /\.(?:c|m)?js$/i.test(path);
}

export function npmInvocation(args: string[], context: NpmContext): Invocation {
  const execPath = context.env.npm_execpath;

  // Preferred: run npm's own CLI with the Node we are already inside. Taken
  // whenever the packager was started by `npm run`, which is how OPERATIONS.md
  // and packaging/windows/README.md both document it.
  if (execPath !== undefined && execPath !== '' && isJavaScript(execPath)) {
    return { command: context.nodePath, args: [execPath, ...args], shell: false };
  }

  // Fallback: someone ran the packager directly, so npm has told us nothing.
  if (context.platform === 'win32') {
    return { command: 'npm.cmd', args, shell: true };
  }
  return { command: 'npm', args, shell: false };
}
