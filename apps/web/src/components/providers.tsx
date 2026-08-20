'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ApiRequestError } from '@/lib/api-client';

export function Providers({
  children,
  nonce,
}: {
  children: ReactNode;
  /**
   * Per-request CSP nonce from the proxy.
   *
   * `next-themes` injects an inline script that applies the stored theme before
   * first paint. Under our nonce-based policy an un-nonced inline script is
   * blocked outright — and `'strict-dynamic'` does not rescue it, since that
   * only extends trust to scripts *loaded by* trusted scripts. Without this the
   * theme is applied a frame late by the hydration effect instead, so every
   * dark-mode user sees a flash of light on load. It only reproduces in
   * production, because dev additionally allows `'unsafe-inline'`.
   */
  nonce?: string;
}) {
  // Created in state so each browser session gets exactly one client, and a
  // Fast Refresh does not discard the cache.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Retrying a 4xx just repeats a rejected request; only transient
              // failures are worth another attempt.
              if (error instanceof ApiRequestError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Switching locale swaps the `[locale]` root layout, which remounts this
        provider. next-themes re-renders its inline <script> on that client
        render, and React logs "Encountered a script tag while rendering React
        component". It is a development-only warning from inside next-themes:
        the script is inert on the client, the theme is applied by the provider's
        own effect, and production emits nothing. Avoiding it entirely would mean
        hoisting ThemeProvider above `[locale]`, which is not possible while
        <html lang> has to come from the locale.
      */}
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        {...(nonce ? { nonce } : {})}
        // Colour transitions during a theme swap read as a flash rather than
        // as polish.
        disableTransitionOnChange
      >
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast:
                'bg-surface! border-border-default! text-foreground! rounded-xl! shadow-raised!',
              description: 'text-foreground-muted!',
            },
          }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
