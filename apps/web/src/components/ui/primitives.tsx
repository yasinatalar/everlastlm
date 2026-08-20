'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'rounded-card border border-border-default bg-surface shadow-panel',
        className,
      )}
      {...props}
    />
  );
}

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-foreground-muted border-border-default',
  accent: 'bg-accent-subtle text-accent-text border-transparent',
  success: 'bg-success/10 text-success border-transparent',
  warning: 'bg-warning/10 text-warning border-transparent',
  danger: 'bg-danger-subtle text-danger border-transparent',
  muted: 'bg-transparent text-foreground-subtle border-border-default',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentPropsWithoutRef<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5',
        'text-[11px] font-medium leading-4 tracking-[0.01em]',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('shimmer rounded-lg', className)} aria-hidden {...props} />;
}

/**
 * The empty state carries more weight in this product than usual — a new user
 * sees three of them before they see any data — so it gets real hierarchy
 * rather than a single grey line.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-surface-sunken text-foreground-subtle">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-medium tracking-[-0.01em] text-foreground">{title}</p>
      {body && (
        <p className="mt-1.5 max-w-[38ch] text-[13px] leading-relaxed text-foreground-muted">
          {body}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border-default px-4',
        className,
      )}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground-muted">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="text-[12px] tabular-nums text-foreground-subtle">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}
