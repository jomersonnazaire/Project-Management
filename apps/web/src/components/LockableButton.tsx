import type { ComponentProps } from 'react';
import { Button } from 'react-bootstrap';

export const DAY_LOCKED_TIP = 'This day is locked';

/**
 * A button that stays visible on a submitted or locked day but can't be used. A disabled
 * <button> fires no mouse events, so the tooltip lives on a wrapper span; the button carries
 * aria-disabled and the same title so screen readers and touch users get the reason too.
 */
export function LockableButton({
  locked,
  lockedTitle = DAY_LOCKED_TIP,
  title,
  onClick,
  ...props
}: ComponentProps<typeof Button> & { locked: boolean; lockedTitle?: string }) {
  if (!locked)
    return (
      <Button title={title} onClick={onClick} {...props}>
        {props.children}
      </Button>
    );
  return (
    <span className="d-inline-block lockable-wrap" title={lockedTitle} tabIndex={0}>
      <Button
        {...props}
        disabled
        aria-disabled="true"
        title={lockedTitle}
        style={{ ...props.style, pointerEvents: 'none' }}
      >
        {props.children}
      </Button>
    </span>
  );
}
