import { useEffect, useRef } from "react";

/**
 * Visual-only animated fog background (Vanta.js + three.js).
 * Renders into a fixed, full-viewport layer behind the app. No app logic involved.
 *
 * Three.js + Vanta are heavy (~900 kB combined) and visual-only, so they are pulled in
 * via dynamic import() inside the effect. This keeps them out of the main entry chunk;
 * Vite emits them as a separate async chunk that loads after first paint.
 */
export function VantaBackground() {
  const ref = useRef<HTMLDivElement>(null);
  const effectRef = useRef<{ destroy?: () => void } | null>(null);

  useEffect(() => {
    if (!ref.current || effectRef.current) return;
    let cancelled = false;

    void Promise.all([
      import("three"),
      import("vanta/dist/vanta.fog.min")
    ]).then(([threeMod, fogMod]) => {
      // Bail out if the component unmounted before the async chunk resolved.
      if (cancelled || !ref.current || effectRef.current) return;
      const THREE = threeMod;
      const FOG = (fogMod as { default?: unknown }).default ?? fogMod;
      effectRef.current = (FOG as (opts: Record<string, unknown>) => { destroy?: () => void })({
        el: ref.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200.0,
        minWidth: 200.0,
        // Retinted to the UI palette: cyan highlights → violet midtones → deep-violet
        // shadows over the app's near-black base.
        highlightColor: 0x29d8ff, // --brand2 (cyan)
        midtoneColor: 0x6c4bd6, // violet, between --brand1 and shadow
        lowlightColor: 0x1a1140, // deep violet shadow
        baseColor: 0x06070b, // --bg (app background)
        blurFactor: 0.46,
        speed: 2.0,
        zoom: 0.7
      });
    });

    return () => {
      cancelled = true;
      effectRef.current?.destroy?.();
      effectRef.current = null;
    };
  }, []);

  return <div ref={ref} className="vanta-bg" aria-hidden="true" />;
}
