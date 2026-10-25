import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ResolveGrid — National Postcode Intelligence, Last-Mile Dispatch & Ground-Truth ML Engine',
  description:
    'Built on the Official NIPOST 11-Character Alphanumeric Postcode API (NDAPS) with Node.js, Redis H3 Geospatial, MySQL ACID Outbox, Multi-Tool LLM Agent, and LightGBM + Online River Telemetry.',
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
