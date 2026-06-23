import { useEffect, useRef, useState } from "react";

/**
 * Visual-only animated counter. Counts up to `value` on mount / when value changes.
 * Does not alter any data — it only animates the display of a number the app already has.
 */
export function AnimatedNumber({
  value,
  format = (n) => n.toFixed(2),
  prefix = "",
  duration = 650
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  prefix?: string;
  duration?: number;
}) {
  const target = typeof value === "number" && isFinite(value) ? value : null;
  const [display, setDisplay] = useState(target ?? 0);
  const fromRef = useRef(0);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (target == null) return;
    const from = fromRef.current;
    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic for a premium settle
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      setDisplay(current);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        fromRef.current = target;
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  if (target == null) return <>{prefix}-</>;
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{prefix}{format(display)}</span>;
}
