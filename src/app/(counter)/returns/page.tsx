import { redirect } from 'next/navigation';

import { currentSession } from '@/auth/session';

import { ReturnsSurface } from './returns-surface';

/** Returns — W4, Phase 10 §2 surface 3, F7. */
export default async function ReturnsPage() {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }
  return <ReturnsSurface />;
}
