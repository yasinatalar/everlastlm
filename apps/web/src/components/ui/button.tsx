'use client';

import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

/**
 * `primary` is the acid-green button. There should be at most one visible in a
 * view — it is the accent, and an interface with five accents has none.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-foreground hover:bg-accent-hover active:brightness-95 font-medium shadow-xs',
  secondary:
    'bg-surface text-foreground border border-border-default hover:bg-surface-hover hover:border-border-strong',
  outline:
    'border border-border-strong text-foreground hover:bg-surface-hover bg-transparent',
  ghost: 'text-foreground-muted hover:text-foreground hover:bg-surface-hover',
  danger: 'bg-danger text-white hover:brightness-110 font-medium',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9.5 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, asChild, children, disabled, ...props },
  ref,
) {
  const classes = cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap',
    'transition-[background-color,border-color,color,opacity] duration-150',
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );

  /**
   * `Slot` merges props onto exactly one child and throws on more than one.
   * Rendering `{loading && <Loader2 />}{children}` always hands it two, even
   * when `loading` is false, so the spinner is only rendered on the real
   * <button> branch. A slotted child (typically a Link) has no loading state
   * to show anyway.
   */
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      // A loading button stays focusable but is not activatable, so focus is
      // not lost mid-action.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
