/**
 * Skeleton — a placeholder block for `loading.tsx` fallbacks.
 *
 * Deliberately shaped like the content it stands in for rather than a spinner:
 * the page then settles into place instead of swapping one screen for another.
 *
 * The pulse is suppressed under `prefers-reduced-motion` (SPEC §3.6). It uses
 * Tailwind's keyframe rather than a motion token because the duration tokens
 * collapse to `0s`, which would freeze a keyframe mid-cycle rather than stop it.
 */

export interface SkeletonProps {
  className?: string;
  /** Accessible label when this block stands in for something meaningful. */
  label?: string;
}

export function Skeleton({ className = "", label }: SkeletonProps) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "status" : undefined}
      className={`block animate-pulse rounded-sm bg-edge motion-reduce:animate-none ${className}`}
    />
  );
}
