import { useEffect, useRef } from "react";

const LONG_PRESS_MS = 500;

/**
 * Tap runs `onTap`; holding for LONG_PRESS_MS runs `onLongPress` instead and swallows the
 * click that follows the release, so holding never adds. Without `onLongPress` a hold does nothing.
 */
export function useLongPress() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (onTap: () => void, onLongPress?: () => void) => ({
    onPointerDown: () => {
      cancel();
      fired.current = false;
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        if (!onLongPress) return;
        onLongPress();
        navigator.vibrate?.(30);
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap();
    },
  });
}
