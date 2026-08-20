'use client';

import dynamic from 'next/dynamic';
import { WorkspaceSkeleton } from './workspace-skeleton';

/**
 * Loads the workspace on the client only.
 *
 * Everything the workspace renders is derived from queries made with the
 * *browser's* Supabase session — the server holds no such token, so a server
 * render can only ever produce the empty state. The moment React Query has
 * anything cached, the client's first render disagrees with that HTML and
 * hydration fails:
 *
 *   server: <textarea disabled={true}>   (0 sources — all the server can know)
 *   client: <textarea>                   (sources are cached)
 *
 * Suppressing the warning would leave the DOM genuinely wrong, because React
 * does not patch up mismatched attributes. Skipping SSR for this subtree is
 * the accurate statement: the data is not knowable server-side. It also
 * removes the flash of "no sources yet" that preceded every load.
 *
 * The route is authenticated and `noindex`, so there is no SEO cost.
 */
export const NotebookWorkspaceLoader = dynamic(
  () => import('./notebook-workspace').then((m) => m.NotebookWorkspace),
  { ssr: false, loading: () => <WorkspaceSkeleton /> },
);
