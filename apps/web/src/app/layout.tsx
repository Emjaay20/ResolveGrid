import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ResolveGrid — Address Intelligence Operations',
  description: 'Source-aware Nigerian address resolution, dispatch readiness, and consented field evidence.',
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
