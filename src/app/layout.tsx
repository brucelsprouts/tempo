import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TEMPO',
  description: 'Continuous calendar.',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  /**
   * iOS reads none of the manifest's display fields. `capable` is what gives
   * the Home Screen app its own window — and therefore what makes it eligible
   * for push at all — and the status bar style has to be declared here because
   * a translucent bar is the only one that doesn't paint a light strip above a
   * black interface.
   */
  appleWebApp: {
    capable: true,
    title: 'Tempo',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#08090a',
  // The app is a fixed-height grid with its own scroll containers, so a
  // double-tap zoom only ever misaligns it. `viewport-fit: cover` lets the
  // background reach under the notch, which `h-full` on a black body wants.
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-void text-ink">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
