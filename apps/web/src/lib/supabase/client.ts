'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client. Only ever sees the anon key — every row it can read
 * is a row RLS decided it may read.
 */
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
