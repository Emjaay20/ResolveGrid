import { ImageResponse } from 'next/og';

export const alt = 'ResolveGrid — Structured locations for better delivery';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#123f37',
          color: '#fcf9f2',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 34, fontWeight: 700 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: 16,
              background: '#0e4d45',
              border: '2px solid #2f6b60',
              fontSize: 26,
            }}
          >
            RG
          </div>
          ResolveGrid
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            Every delivery starts with a location people can trust.
          </div>
          <div style={{ fontSize: 30, color: '#b9d3c7' }}>
            Address intelligence for Nigerian delivery, built on the national digital postcode.
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: '#a8d672' }}>FC-02-A09-DB-09 · source-aware · consent-first</div>
      </div>
    ),
    size
  );
}
