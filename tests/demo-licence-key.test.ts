import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { signPayload } from '@/domain/licensing/sign';
import type { LicencePayload } from '@/domain/licensing/state';
import { verifyToken } from '@/domain/licensing/verify';

import { resolveDemoSigningKey } from '../scripts/db/demo-licence-key';

/**
 * The regression this guards: `db:seed` used to sign the demo's "perpetual"
 * licence with the committed development key, which `composeTrustRoot`
 * correctly drops from the trust root the moment a production key exists — so
 * the demo's own licence resolved to `invalid` forever. `resolveDemoSigningKey`
 * is the fix's pure half: it must return `null` (never a dev-key fallback) when
 * no real key is configured, and must actually parse a configured one.
 */
describe('resolveDemoSigningKey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mehvar-demo-key-'));
  const keyPath = join(dir, 'signing-key.b64');

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  writeFileSync(
    keyPath,
    `${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url')}\n`,
    'utf8',
  );

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is null when MEHVAR_LICENCE_SIGNING_KEY is unset', () => {
    expect(resolveDemoSigningKey({})).toBeNull();
  });

  it('is null when the variable is set but blank', () => {
    expect(resolveDemoSigningKey({ MEHVAR_LICENCE_SIGNING_KEY: '   ' })).toBeNull();
  });

  it('reads and parses a configured key file, defaulting the kid to mehvar-1', () => {
    const resolved = resolveDemoSigningKey({ MEHVAR_LICENCE_SIGNING_KEY: keyPath });
    expect(resolved).not.toBeNull();
    expect(resolved?.kid).toBe('mehvar-1');
  });

  it('trims surrounding whitespace on the path, same as the other licence scripts', () => {
    const resolved = resolveDemoSigningKey({ MEHVAR_LICENCE_SIGNING_KEY: `  ${keyPath}  ` });
    expect(resolved).not.toBeNull();
  });

  it('the resolved key actually signs a token its own public key verifies', () => {
    const resolved = resolveDemoSigningKey({ MEHVAR_LICENCE_SIGNING_KEY: keyPath });
    expect(resolved).not.toBeNull();
    if (resolved === null) return;

    const payload: LicencePayload = {
      v: 2,
      kid: resolved.kid,
      licenceId: '0198a000-0000-7000-8000-000000000099',
      tenantSlug: 'demo',
      customerName: 'Al-Shifa Medical Store',
      issuedAt: '2026-01-01T00:00:00Z',
    };
    const token = signPayload(payload, resolved.key);

    const verified = verifyToken(token, { keyring: { [resolved.kid]: publicKeyB64 } });
    expect(verified.ok).toBe(true);
  });

  it('never falls back to the development key — no such fallback exists in this module', () => {
    // The regression's exact shape: a script that reaches for the published
    // dev private key when no real one is configured. This module must not
    // import it at all — checked by import, not by the prose that explains why.
    const source = readFileSync(
      join(process.cwd(), 'scripts', 'db', 'demo-licence-key.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"].*dev-key['"]|\bDEV_KID\b|\bDEV_PRIVATE_KEY_PKCS8_BASE64URL\b/);
  });
});
