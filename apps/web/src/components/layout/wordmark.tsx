import { cn } from '@/lib/utils';

/**
 * The mark is a single acid-green square — the one place the accent appears
 * unconditionally, which is what makes it read as brand rather than as state.
 */
export function Wordmark({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold', className)}>
      <span
        className="grid size-6 place-items-center rounded-[7px] bg-acid-300 text-anthracite-950"
        aria-hidden
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
          <path
            d="M3 4.5h10M3 8h7M3 11.5h10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {showText && (
        <span className="text-[15px] tracking-[-0.02em]">Everlast</span>
      )}
    </span>
  );
}
