import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

// Phase 10 §6: Inter (variable). Numerals are the brand's real typeface.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Mehvar Pharmacy',
  description: 'Pharmacy counter operations — faster than the register, and it cannot lie.',
  // ADR-3: the counter is a PWA. Installing it is what gives the shop a
  // window with no address bar and its own icon (Phase 12 §6's kiosk setup).
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'Mehvar', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The counter surface is a fixed keyboard-first workspace; the owner surface
  // (Phase 10 §2) is responsive within the same app.
  maximumScale: 5,
  // `theme_color` lives in the manifest rather than here: the token lint rule
  // (Phase 10 §9) rightly refuses a raw hex in app code, and the manifest is
  // the same kind of legitimate exception `globals.css` is.
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
