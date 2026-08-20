'use client';

/**
 * Last-resort boundary: it replaces the root layout, so it must render its own
 * <html>/<body> and cannot rely on providers, translations or the stylesheet.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f7f6f2',
          color: '#16181a',
        }}
      >
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <h1 style={{ fontSize: '1.125rem', margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: '.5rem', color: '#656f79', fontSize: '.875rem' }}>
            Please reload the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '.5rem 1rem',
              borderRadius: '.5rem',
              border: 'none',
              background: '#c2f050',
              color: '#16181a',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
