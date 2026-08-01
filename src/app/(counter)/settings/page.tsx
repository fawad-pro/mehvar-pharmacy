import { redirect } from 'next/navigation';

import { currentSession } from '@/auth/session';

import { SettingsSurface } from './settings-surface';

/** Settings — Phase 10 §2 surface 9, owner-only. */
export default async function SettingsPage() {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }
  if (session.userRole !== 'owner') {
    redirect('/sale');
  }
  return <SettingsSurface />;
}
