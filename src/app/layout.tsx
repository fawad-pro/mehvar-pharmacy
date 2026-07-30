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
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The counter surface is a fixed keyboard-first workspace; the owner surface
  // (Phase 10 §2) is responsive within the same app.
  maximumScale: 5,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
