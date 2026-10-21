import { describe, expect, it } from 'vitest';

import { redactSecrets } from './redact';

/**
 * What the support bundle may carry. The cases are the real lines the upgrade
 * test found in an install log that the bundle then sent over WhatsApp.
 */
describe('redactSecrets', () => {
  it('drops the password from a connection URL, keeping the user and host', () => {
    expect(
      redactSecrets(
        'run: psql.exe postgresql://mehvar:Abc123xyz@localhost:5433/postgres -v ON_ERROR_STOP=1',
      ),
    ).toBe(
      'run: psql.exe postgresql://mehvar:<redacted>@localhost:5433/postgres -v ON_ERROR_STOP=1',
    );
  });

  it("masks init's one-time credentials in every form it writes them", () => {
    expect(redactSecrets('  Pairing key  gtud-jfcb-rj4x')).toBe('  Pairing key  <redacted>');
    expect(redactSecrets('Owner password: jcsk-t26s-nbwf   (remote login)')).toBe(
      'Owner password: <redacted>   (remote login)',
    );
    expect(redactSecrets('  Owner pass   jcsk-t26s-nbwf')).toBe('  Owner pass   <redacted>');
    expect(redactSecrets('    Setup key      j6xp-68up-6qrk')).toBe(
      '    Setup key      <redacted>',
    );
  });

  it('masks settings whose names say they are secret', () => {
    expect(
      redactSecrets(
        'APP_DB_PASSWORD=hunter2 SESSION_SECRET=abc NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=xyz=',
      ),
    ).toBe(
      'APP_DB_PASSWORD=<redacted> SESSION_SECRET=<redacted> NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=<redacted>',
    );
  });

  it('leaves ordinary diagnostics untouched', () => {
    const lines = [
      'mehvar_pharmacy on localhost:5433 as mehvar: applied 1 migration(s).',
      '01a0d092-4e36-74ec: ok — 160 batches agree with the records',
      'Newest dump: mehvar-2026-09-23T23-29-44-182.dump',
      'Licence id:    01a0d0',
    ].join('\n');
    expect(redactSecrets(lines)).toBe(lines);
  });
});
