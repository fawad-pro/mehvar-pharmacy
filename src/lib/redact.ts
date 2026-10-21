/**
 * Strip credentials from text that is about to leave the machine.
 *
 * The support bundle is sent to Mehvar over WhatsApp, and it carries the tail
 * of the newest log — which, right after an install, is the installer's own
 * log: the owner's database password inside every psql connection URL it ran,
 * and init's "Pairing key / Owner pass" lines. Redacting at the edge, line by
 * line, means a log written by a future step that forgets is still covered.
 *
 * Deliberately pattern-based and conservative: it removes the secret and keeps
 * the shape, so the line still says what happened. Bare words are left alone —
 * guessing at them would mangle ordinary log text.
 */
const RULES: ReadonlyArray<[RegExp, string]> = [
  // postgresql://user:password@host — keep the user, drop the password.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:)[^@\s]+@/gi, '$1<redacted>@'],
  // KEY=value for anything that names a secret.
  [/\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY)[A-Z0-9_]*\s*=\s*)\S+/g, '$1<redacted>'],
  // init's one-time credentials, as it prints and writes them.
  [/\b(Pairing key|Setup key|Owner pass(?:word)?)(:?\s+)\S+/gi, '$1$2<redacted>'],
];

export function redactSecrets(text: string): string {
  return RULES.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}
