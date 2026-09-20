/**
 * The licence token's wire format.
 *
 * One line of text the owner receives over WhatsApp and pastes into Settings:
 *
 *     MEHVAR1.<base64url(payload JSON)>.<base64url(ed25519 signature)>
 *
 * Shaped like a JWT and deliberately not one: there is no `alg` field and no
 * header to negotiate. `signature.ts` knows the algorithm; the token only gets
 * to name which KEY signed it.
 *
 * `installationId` is deliberately not in the payload. A licence is issued
 * unbound and binds on first use, so one issued token works whenever the
 * pharmacy installs and on whichever machine they end up using — which is what
 * keeps one installer serving every customer, with no per-customer build.
 */

import { LICENCE_FORMAT_VERSION, type LicencePayload } from './state';

export const TOKEN_PREFIX = 'MEHVAR1';

export type TokenParseFailure =
  | { readonly ok: false; readonly reason: 'malformed' }
  | { readonly ok: false; readonly reason: 'format_too_new'; readonly found: number };

export type TokenParseResult =
  | {
      readonly ok: true;
      readonly payload: LicencePayload;
      /** The exact bytes the signature covers. Never re-serialised — a
       *  round-trip through JSON could reorder keys and break verification. */
      readonly signedBytes: Uint8Array;
      readonly signature: Uint8Array;
    }
  | TokenParseFailure;

function isLicencePayload(value: unknown): value is LicencePayload {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.v === 'number' &&
    typeof c.kid === 'string' &&
    typeof c.licenceId === 'string' &&
    typeof c.tenantSlug === 'string' &&
    typeof c.customerName === 'string' &&
    typeof c.issuedAt === 'string' &&
    !Number.isNaN(Date.parse(c.issuedAt)) &&
    // Optional future metadata — present or absent, never malformed.
    (c.plan === undefined || c.plan === 'standard') &&
    (c.branches === undefined || typeof c.branches === 'number')
  );
}

/**
 * Parse and structurally validate. Does NOT check the signature — `verify.ts`
 * does that, because it is the only module allowed to reach `node:crypto`.
 *
 * A payload whose `v` is newer than this build understands is **refused whole**,
 * following the catalogue-pack precedent: partially reading a format you do not
 * know is how a licence silently means something other than what was issued.
 */
export function parseToken(token: string): TokenParseResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return { ok: false, reason: 'malformed' };

  const [, encodedPayload, encodedSignature] = parts as [string, string, string];

  let json: string;
  let signature: Uint8Array;
  try {
    json = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    signature = new Uint8Array(Buffer.from(encodedSignature, 'base64url'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (signature.length === 0) return { ok: false, reason: 'malformed' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!isLicencePayload(parsed)) return { ok: false, reason: 'malformed' };
  if (parsed.v > LICENCE_FORMAT_VERSION)
    return { ok: false, reason: 'format_too_new', found: parsed.v };

  return {
    ok: true,
    payload: parsed,
    signedBytes: new Uint8Array(Buffer.from(encodedPayload, 'utf8')),
    signature,
  };
}

/**
 * The bytes a signer must sign: the base64url payload segment itself, not the
 * JSON.
 *
 * Signing the encoded segment rather than the decoded object is what makes
 * verification independent of JSON key order, whitespace and number formatting —
 * the parser hands back exactly the bytes it read.
 */
export function encodePayload(payload: LicencePayload): {
  readonly segment: string;
  readonly signedBytes: Uint8Array;
} {
  const segment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { segment, signedBytes: new Uint8Array(Buffer.from(segment, 'utf8')) };
}

export function assembleToken(segment: string, signature: Uint8Array): string {
  return `${TOKEN_PREFIX}.${segment}.${Buffer.from(signature).toString('base64url')}`;
}
