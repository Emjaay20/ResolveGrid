import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'ResolveGrid — Structured locations for better delivery',
    template: '%s · ResolveGrid',
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: 'ResolveGrid — Structured locations for better delivery',
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: 'en_NG',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ResolveGrid — Structured locations for better delivery',
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: '#123f37',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
