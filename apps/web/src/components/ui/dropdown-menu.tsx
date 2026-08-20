'use client';

import * as Primitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[10rem] overflow-hidden rounded-xl border border-border-default',
          'bg-surface p-1 shadow-raised animate-in-up',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

/**
 * `data-active` renders a check mark, which lets the same item serve as both a
 * command and a selection without a separate radio-item component.
 */
export function DropdownMenuItem({
  className,
  children,
  destructive,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Item> & { destructive?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        'group relative flex cursor-pointer select-none items-center gap-2 rounded-lg',
        'px-2.5 py-1.5 text-[13px] outline-none transition-colors',
        'data-highlighted:bg-surface-hover',
        destructive
          ? 'text-danger data-highlighted:bg-danger-subtle'
          : 'text-foreground-muted data-highlighted:text-foreground',
        'data-[active=true]:text-foreground data-[active=true]:font-medium',
        className,
      )}
      {...props}
    >
      {children}
      <Check className="ml-auto size-3.5 opacity-0 group-data-[active=true]:opacity-100" />
    </Primitive.Item>
  );
}

export function DropdownMenuSeparator({
  className,
}: ComponentPropsWithoutRef<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('my-1 h-px bg-border-default', className)} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('px-2.5 py-1.5 text-[11px] font-medium text-foreground-subtle', className)}
      {...props}
    />
  );
}
