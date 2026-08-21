import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional classes and resolves conflicting Tailwind utilities. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export const formatBytes = (bytes: number | null | undefined): string => {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
};

/** `m:ss`, empty only for a duration we do not have — zero is a real time. */
export const formatDuration = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}`;
};

/** Stable initials for the avatar fallback. */
export const initials = (name: string | null | undefined, email?: string | null): string => {
  const source = name?.trim() || email?.split('@')[0] || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};
