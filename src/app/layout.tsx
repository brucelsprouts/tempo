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
  /**
   * The same claim as `appleWebApp.capable`, in the spelling everything that is
   * not Safari reads. Next emits only the `apple-` prefixed tag from the block
   * above, and Chrome has deprecated honouring it — so without this the
   * standalone request is made to exactly one browser, and that browser warns
   * about the tag it is being made with.
   */
  other: { 'mobile-web-app-capable': 'yes' },
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
  /**
   * The on-screen keyboard takes room from the layout rather than sliding over
   * it.
   *
   * Everything in the app is sized against the viewport — `.app-vh` is the
   * window, the modals are `fixed` and `max-h-full` of it — so a keyboard that
   * only overlays leaves the entry form still believing it has 812px and puts
   * CREATE underneath the keys. Resizing the layout viewport instead means
   * `100dvh` shrinks, the modal shrinks with it, and the button stays on screen.
   *
   * Chrome on Android honours this. iOS does not yet, and there it costs
   * nothing — Safari's own scroll-the-focused-field behaviour is unchanged.
   */
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} app-vh antialiased`}
    >
      <body className="app-vh overflow-hidden bg-void text-ink">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
