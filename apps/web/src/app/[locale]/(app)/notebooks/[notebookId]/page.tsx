import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { NotebookWorkspaceLoader } from '@/components/workspace/notebook-workspace.loader';

export default async function NotebookPage({
  params,
}: {
  params: Promise<{ locale: string; notebookId: string }>;
}) {
  const { locale, notebookId } = await params;
  setRequestLocale(locale);

  // A malformed id would otherwise reach the API and come back as a 400 render
  // error; catching it here produces a proper 404 page instead.
  if (!z.uuid().safeParse(notebookId).success) notFound();

  return <NotebookWorkspaceLoader notebookId={notebookId} />;
}
