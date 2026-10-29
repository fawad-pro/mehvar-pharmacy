import { NextResponse } from 'next/server';

import { databaseReachable } from '@/db/health';

/**
 * The platform health check (Railway's `healthcheckPath`).
 *
 * Unauthenticated by design — the platform has no session — so it says
 * nothing about tenants, versions or configuration: `ok` or `database_down`,
 * and nothing else. Never cached.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const ok = await databaseReachable();
  return NextResponse.json(
    { status: ok ? 'ok' : 'database_down' },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
