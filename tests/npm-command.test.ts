/**
 * The Windows packaging bug, pinned.
 *
 * `execFileSync('npm', …)` is correct on Linux and macOS and fails with ENOENT
 * on Windows, so a Linux-only check can never catch it — which is exactly what
 * happened. These assertions are platform-independent because `npmInvocation`
 * takes the platform as an argument instead of reading it.
 */

import { describe, expect, it } from 'vitest';

import { npmInvocation, type NpmContext } from '../scripts/package/npm-command';

const NODE = '/usr/bin/node';

function context(overrides: Partial<NpmContext> = {}): NpmContext {
  return { platform: 'linux', env: {}, nodePath: NODE, ...overrides };
}

describe('when npm started us (npm run package:build)', () => {
  it("runs npm's own CLI with the current Node, on every platform", () => {
    const env = { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' };

    for (const platform of ['win32', 'linux', 'darwin']) {
      const invocation = npmInvocation(['run', 'build'], context({ platform, env }));

      expect(invocation).toEqual({
        command: NODE,
        args: [env.npm_execpath, 'run', 'build'],
        shell: false,
      });
    }
  });

  it('accepts .mjs and .cjs CLI paths too', () => {
    for (const execpath of ['/usr/lib/npm/npm-cli.mjs', '/usr/lib/npm/npm-cli.cjs']) {
      expect(
        npmInvocation(['run', 'build'], context({ env: { npm_execpath: execpath } })).command,
      ).toBe(NODE);
    }
  });

  it('ignores a .cmd shim in npm_execpath and falls back', () => {
    // Some setups point this at the shim rather than the CLI. Handing a .cmd
    // to the Node binary would fail; it is not JavaScript.
    const invocation = npmInvocation(
      ['run', 'build'],
      context({ platform: 'win32', env: { npm_execpath: 'C:\\npm\\npm.cmd' } }),
    );

    expect(invocation.command).toBe('npm.cmd');
    expect(invocation.shell).toBe(true);
  });

  it('ignores an empty npm_execpath', () => {
    expect(npmInvocation(['run', 'build'], context({ env: { npm_execpath: '' } })).command).toBe(
      'npm',
    );
  });
});

describe('when run directly, with no npm context', () => {
  it('uses npm.cmd on Windows — plain "npm" is what caused the ENOENT', () => {
    const invocation = npmInvocation(['run', 'build'], context({ platform: 'win32' }));

    expect(invocation.command).toBe('npm.cmd');
    expect(invocation.args).toEqual(['run', 'build']);
  });

  it('sets shell: true for the .cmd, which Node requires since CVE-2024-27980', () => {
    // Node >=18.20.2/20.12.2/21.7.3 throws EINVAL spawning a .bat or .cmd
    // without a shell. Dropping this flag reintroduces the Windows failure in
    // a different disguise, so it is asserted on its own.
    expect(npmInvocation(['run', 'build'], context({ platform: 'win32' })).shell).toBe(true);
  });

  it('uses plain npm without a shell everywhere else', () => {
    for (const platform of ['linux', 'darwin', 'freebsd']) {
      expect(npmInvocation(['run', 'build'], context({ platform }))).toEqual({
        command: 'npm',
        args: ['run', 'build'],
        shell: false,
      });
    }
  });

  it('never spawns a bare "npm" on Windows, under any environment', () => {
    // The regression itself, stated once as plainly as possible.
    for (const env of [{}, { npm_execpath: '' }, { npm_execpath: 'C:\\npm\\npm.cmd' }]) {
      expect(npmInvocation(['run', 'build'], context({ platform: 'win32', env })).command).not.toBe(
        'npm',
      );
    }
  });
});
