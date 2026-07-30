import { NextResponse } from 'next/server';

import { currentSession, scopeFor } from '@/auth/session';
import { catalogSnapshot } from '@/db/catalog-queries';

/**
 * The ADR-4 index endpoint.
 *
 * `GET /api/catalog` returns the whole catalog; `?since=<ISO>` returns only what
 * changed. That distinction is the scale story: a 3,000-product catalog is
 * downloaded once per device, and a corrected price afterwards costs one row.
 *
 * A route handler rather than a server action because the payload is a cacheable
 * resource the service worker will want to own on Day 5 (ADR-3).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 });
  }

  const raw = new URL(request.url).searchParams.get('since');
  const since = raw ? new Date(raw) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: 'bad_since' }, { status: 400 });
  }

  const snapshot = await catalogSnapshot(scopeFor(session), since);

  return NextResponse.json(snapshot, {
    // Tenant-scoped and session-bound: never shared, never stored by a proxy.
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
