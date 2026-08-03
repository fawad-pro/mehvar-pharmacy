/**
 * `npm run ops:support-bundle` — one file the owner sends over WhatsApp.
 *
 * Phase 12 §7 makes support WhatsApp-first and founder-answered. What local
 * deployment adds (PCN-004, Part 1 §4.7) is that the founder can no longer look
 * at the machine: there is no platform dashboard, no log stream, nothing to
 * open. Without this, remote diagnosis is guesswork conducted through a person
 * who does not know the vocabulary.
 *
 * It is the difference between a ten-minute and a two-hour support call, and
 * the highest-leverage thing in roadmap Phase 1 that is not the installer.
 *
 * **Deliberately contains no pharmacy data.** No sales, no customers, no
 * prices, no stock. Counts and health only. The owner should be able to send it
 * without thinking about what is in it — and Phase 12 §5's data-minimization
 * posture is not something to undo the first time it is inconvenient.
 */
import 'dotenv/config';

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { hostname, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';

import { backupDir, latestBackup } from '../../src/lib/backup';
import { installationDir, readInstallation } from '../../src/lib/installation';

interface Section {
  heading: string;
  lines: string[];
}

function safely(heading: string, collect: () => string[]): Section {
  try {
    return { heading, lines: collect() };
  } catch (error) {
    // A bundle that fails to build is a bundle nobody sends. One broken section
    // must never cost the founder the other five.
    return {
      heading,
      lines: [`(could not collect: ${error instanceof Error ? error.message : error})`],
    };
  }
}

function machineSection(): Section {
  return safely('Machine', () => [
    `Host:        ${hostname()}`,
    `Platform:    ${platform()} ${release()}`,
    `Node:        ${process.version}`,
    `Memory:      ${(totalmem() / 1024 ** 3).toFixed(1)} GB`,
    `Generated:   ${new Date().toISOString()}`,
  ]);
}

function installationSection(): Section {
  return safely('Installation', () => {
    const record = readInstallation();
    if (record === undefined) {
      return ['No installation record — `npm run init` has not run on this machine.'];
    }
    return [
      `Installation: ${record.installationId}`,
      `Installed:    ${record.installedAt}`,
      `Version:      ${record.installedVersion}`,
      `Data dir:     ${installationDir()}`,
    ];
  });
}

function backupSection(): Section {
  return safely('Backups', () => {
    const directory = backupDir();
    if (!existsSync(directory)) {
      return [`No backup directory at ${directory} — the nightly job has never run.`];
    }

    const newest = latestBackup(directory);
    if (newest === undefined) {
      return [`Backup directory exists but holds no dumps: ${directory}`];
    }

    const { size, mtime } = statSync(join(directory, newest));
    const ageHours = (Date.now() - mtime.getTime()) / 36e5;

    return [
      `Directory:   ${directory}`,
      `Newest dump: ${newest}`,
      `Size:        ${(size / 1024 / 1024).toFixed(1)} MB`,
      `Age:         ${ageHours.toFixed(1)} hours`,
      // The single most useful line in the whole bundle: a shop whose backups
      // stopped two months ago looks completely healthy until you ask.
      ageHours > 48 ? 'WARNING: the newest backup is more than 48 hours old.' : 'Backup age OK.',
    ];
  });
}

function firstRunSection(): Section {
  return safely('First-run details', () => {
    const file = join(installationDir(), 'first-run.txt');
    if (!existsSync(file)) return ['(none — this machine was not provisioned by the installer)'];

    // Credentials live in this file. Report only that it exists.
    return [`Present at ${file} (contents omitted — it holds the pairing key).`];
  });
}

function logSection(): Section {
  return safely('Recent log lines', () => {
    const dir = process.env.MEHVAR_LOG_DIR ?? join(installationDir(), 'logs');
    if (!existsSync(dir)) return [`No log directory at ${dir}.`];

    const newest = readdirSync(dir)
      .filter((name) => name.endsWith('.log'))
      .sort()
      .at(-1);
    if (newest === undefined) return [`No .log files in ${dir}.`];

    const lines = readFileSync(join(dir, newest), 'utf8').split('\n');
    return [`From ${newest}:`, '', ...lines.slice(-200)];
  });
}

async function verifierSection(): Promise<Section> {
  if (!process.env.DATABASE_URL) {
    return {
      heading: 'Verifier',
      lines: ['DATABASE_URL is not set — could not run the verifier.'],
    };
  }

  const captured: string[] = [];
  const { log, error } = console;
  console.log = (...args: unknown[]) => captured.push(args.join(' '));
  console.error = (...args: unknown[]) => captured.push(args.join(' '));

  try {
    const { verifyAllTenants } = await import('../db/verify-all');
    const ok = await verifyAllTenants();
    captured.push('', ok ? 'Verifier: OK' : 'Verifier: SEV-1 — records and caches disagree');
  } catch (caught) {
    captured.push(`Could not run: ${caught instanceof Error ? caught.message : caught}`);
  } finally {
    console.log = log;
    console.error = error;
  }

  return { heading: 'Verifier (ADR-8)', lines: captured };
}

async function main(): Promise<void> {
  const sections: Section[] = [
    machineSection(),
    installationSection(),
    backupSection(),
    firstRunSection(),
    await verifierSection(),
    logSection(),
  ];

  const outDir = process.env.MEHVAR_SUPPORT_DIR ?? join(installationDir(), 'support');
  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const target = join(outDir, `mehvar-support-${stamp}.txt`);

  const stream = createWriteStream(target, 'utf8');
  stream.write('Mehvar support bundle\n');
  stream.write('Contains no sales, customer, price or stock data.\n');
  for (const section of sections) {
    stream.write(`\n\n=== ${section.heading} ===\n\n`);
    stream.write(section.lines.join('\n'));
  }
  stream.write('\n');
  stream.end();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  console.log(`\n  Support bundle written to:\n  ${target}\n`);
  console.log('  Send this file to Mehvar support on WhatsApp.\n');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
