'use client';

import * as Primitive from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = Primitive.Provider;
export const Tooltip = Primitive.Root;
export const TooltipTrigger = Primitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 rounded-lg border border-border-default bg-surface px-2.5 py-2',
          'shadow-raised animate-in-up',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
