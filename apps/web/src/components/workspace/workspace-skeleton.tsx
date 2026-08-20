import { Skeleton } from '@/components/ui/primitives';

/**
 * Shown while the workspace bundle loads. Mirrors the real three-pane layout so
 * the transition is a fill-in rather than a jump.
 */
export function WorkspaceSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-default bg-surface px-3">
        <Skeleton className="size-7 rounded-lg" />
        <Skeleton className="h-4 w-44" />
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] lg:grid-cols-[320px_1fr_360px] lg:grid-rows-1">
        <aside className="order-2 min-h-0 space-y-2 border-t border-border-default bg-surface p-3 lg:order-1 lg:border-r lg:border-t-0">
          <Skeleton className="mb-3 h-4 w-20" />
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </aside>

        <section className="order-1 flex min-h-0 flex-col lg:order-2">
          <div className="h-12 border-b border-border-default" />
          <div className="flex flex-1 items-center justify-center">
            <Skeleton className="h-24 w-72" />
          </div>
          <div className="border-t border-border-default p-4">
            <Skeleton className="mx-auto h-12 w-full max-w-3xl rounded-xl" />
          </div>
        </section>

        <aside className="order-3 min-h-0 space-y-2 border-t border-border-default bg-surface p-3 lg:border-l lg:border-t-0">
          <Skeleton className="mb-3 h-4 w-16" />
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </aside>
      </div>
    </div>
  );
}
