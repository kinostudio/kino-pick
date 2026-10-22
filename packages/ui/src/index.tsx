import type { ComponentProps } from 'react';
import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
// shadcn-style source-owned primitive; no external component service.
const button = cva(
  'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-stone-900 text-white',
        outline: 'border border-stone-300 bg-white text-stone-900',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
export function Button({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'button'> & { variant?: 'default' | 'outline' }) {
  return (
    <button
      className={twMerge(clsx(button({ variant }), className))}
      {...props}
    />
  );
}
