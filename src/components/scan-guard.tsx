'use client';

/**
 * Mounts the counter's scan guard (`client/scan/field-guard.ts`) and says
 * when it put a scan back — once, above every overlay, for a few seconds.
 * Silent correction would leave the operator wondering why Enter "did
 * nothing"; a sentence tells them where the scan belongs (I5).
 */

import { useEffect, useState } from 'react';

import { installScanFieldGuard, SCAN_BLOCKED_EVENT } from '@/client/scan/field-guard';

const SHOWN_MS = 6_000;

export function ScanGuard() {
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => installScanFieldGuard(), []);

  useEffect(() => {
    const onBlocked = () => {
      setShownAt(Date.now());
    };
    window.addEventListener(SCAN_BLOCKED_EVENT, onBlocked);
    return () => {
      window.removeEventListener(SCAN_BLOCKED_EVENT, onBlocked);
    };
  }, []);

  useEffect(() => {
    if (shownAt === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      setShownAt(null);
    }, SHOWN_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [shownAt]);

  if (shownAt === null) {
    return null;
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-center px-4">
      <p
        key={shownAt}
        role="alert"
        className="bg-paper border-red text-ink max-w-md rounded border-2 px-4 py-2 text-sm shadow-xl"
      >
        <span className="font-medium">That was a barcode — nothing was entered or saved.</span> This
        field does not take scans; scan products in the search box.
      </p>
    </div>
  );
}
