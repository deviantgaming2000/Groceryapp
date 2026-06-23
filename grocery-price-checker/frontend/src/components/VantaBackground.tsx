import { useEffect, useRef } from "react";
import * as THREE from "three";
import FOG from "vanta/dist/vanta.fog.min";

/**
 * Visual-only animated fog background (Vanta.js + three.js).
 * Renders into a fixed, full-viewport layer behind the app. No app logic involved.
 */
export function VantaBackground() {
  const ref = useRef<HTMLDivElement>(null);
  const effectRef = useRef<{ destroy?: () => void } | null>(null);

  useEffect(() => {
    if (!ref.current || effectRef.current) return;
    effectRef.current = FOG({
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
    return () => {
      effectRef.current?.destroy?.();
      effectRef.current = null;
    };
  }, []);

  return <div ref={ref} className="vanta-bg" aria-hidden="true" />;
}
