/**
 * The counter server, as the Windows service runs it.
 *
 * WinSW supervises `node.exe` directly, and this is what node.exe is pointed
 * at. It exists because the two obvious alternatives both fail:
 *
 *   - Pointing the service at `server.js` gives a server with no configuration.
 *     Next's standalone server does not load a `.env` file; it reads
 *     `process.env` and nothing else.
 *   - Pointing it at `node -r dotenv/config server.js` fails to resolve, because
 *     `dotenv` is a devDependency that Next never traces into the standalone
 *     tree. That is the same MODULE_NOT_FOUND that killed the ops scripts.
 *
 * This file is bundled by `package:build`, so `dotenv` is compiled INTO it and
 * needs no resolution at runtime. It loads the environment, then hands over to
 * the standalone server in the same process -- so the PID WinSW is watching is
 * the PID actually serving, which is what makes its restart policy mean
 * anything.
 *
 * The previous design had WinSW (or sc.exe) run a `.cmd` that parsed `.env`
 * with a `for /f` loop and then launched node. That worked, but the supervised
 * process was cmd.exe rather than the server: killing it could orphan node, and
 * a crashed server looked healthy to the supervisor.
 */
import 'dotenv/config';

import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * `server.js` sits two levels up from `app/bin/ops/serve.js`.
 *
 * Resolved through `createRequire` rather than a bare `require`, so esbuild
 * treats it as a runtime path and does not try to bundle Next's entire server
 * into this file. `MEHVAR_SERVER_JS` overrides it for tests.
 */
function serverEntryPoint(): string {
  const override = process.env.MEHVAR_SERVER_JS;
  if (override !== undefined && override.trim() !== '') return override.trim();
  return join(__dirname, '..', '..', 'server.js');
}

function main(): void {
  const entry = serverEntryPoint();

  // Next's standalone server reads these two and defaults to 3000/localhost.
  // Binding 0.0.0.0 is what lets a second counter reach this one over the LAN;
  // the firewall rule the installer adds is the actual access control.
  process.env.PORT ??= '3000';
  process.env.HOSTNAME ??= '0.0.0.0';

  console.log(`Mehvar counter server starting on ${process.env.HOSTNAME}:${process.env.PORT}`);
  console.log(`  entry point: ${entry}`);

  // Starting the server IS requiring it: Next's standalone output listens at
  // module scope. Nothing follows, and nothing should.
  createRequire(__filename)(entry);
}

main();
