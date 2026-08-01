import JSZip from 'jszip';
import { NextResponse } from 'next/server';

import { currentSession, scopeFor } from '@/auth/session';
import { tenantDataExport } from '@/db/export-queries';
import { toCsv } from '@/lib/csv';

/**
 * `GET /api/export` — Phase 9 §8's tenant data export, owner-only (Phase 10
 * §2's Settings entry).
 *
 * A route handler, not a server action: the deliverable is a binary download,
 * which server actions cannot stream, and Phase 3 §5.3's export-stays-open
 * promise makes this the one endpoint that should not need a page navigation
 * to reach.
 */
export async function GET(): Promise<NextResponse> {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 });
  }
  if (session.userRole !== 'owner') {
    return NextResponse.json({ error: 'owner_only' }, { status: 403 });
  }
  // Phase 3 §5.3 / ADR-2 §4: suspension gates writes, never this endpoint —
  // the data stays reachable regardless of payment state (T3).

  const tables = await tenantDataExport(scopeFor(session));

  const zip = new JSZip();
  for (const table of tables) {
    zip.file(`${table.name}.csv`, toCsv(table.rows));
  }
  const archive = await zip.generateAsync({ type: 'arraybuffer' });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Blob([archive]), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${session.tenantSlug}-export-${stamp}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
