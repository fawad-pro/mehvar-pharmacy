/**
 * UUIDv7 — Phase 9 §1's primary-key convention.
 *
 * v7 is time-ordered, so primary keys cluster by insertion time: index locality
 * on the append-only event tables, and a natural tiebreak wherever two records
 * share a timestamp.
 *
 * Generated in application code rather than by the database because ADR-3
 * requires `sales` and `payments` to carry a CLIENT-generated id — the counter
 * must be able to mint a durable identity for a sale with no server in reach.
 * One generator, used identically on both sides, keeps that honest.
 *
 * Layout (RFC 9562 §5.7): 48-bit big-endian Unix milliseconds, 4-bit version,
 * 12 bits random, 2-bit variant, 62 bits random.
 */

export type Uuid = string;

const HEX: string[] = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, '0'),
);

export function uuidv7(now: number = Date.now()): Uuid {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestamp = BigInt(Math.trunc(now));
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  // Version 7 in the high nibble of byte 6; RFC 4122 variant in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = (index: number): string => HEX[bytes[index] ?? 0] ?? '00';
  return (
    hex(0) +
    hex(1) +
    hex(2) +
    hex(3) +
    '-' +
    hex(4) +
    hex(5) +
    '-' +
    hex(6) +
    hex(7) +
    '-' +
    hex(8) +
    hex(9) +
    '-' +
    hex(10) +
    hex(11) +
    hex(12) +
    hex(13) +
    hex(14) +
    hex(15)
  );
}

/** Milliseconds encoded in a v7 identifier — used by tests and diagnostics. */
export function uuidv7Timestamp(id: Uuid): number {
  return Number(BigInt('0x' + id.replaceAll('-', '').slice(0, 12)));
}
