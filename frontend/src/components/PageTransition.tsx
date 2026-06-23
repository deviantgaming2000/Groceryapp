import { ReactNode } from "react";

/**
 * Wraps the active page. Remounts on pageKey change so the CSS enter animation
 * (soft fade + blur-clear + slide) replays, with a one-shot wispy glow sweep.
 * Honors prefers-reduced-motion via the global media query in app.css.
 */
export function PageTransition({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  return (
    <div className="page-transition" key={pageKey}>
      <span className="page-sweep" aria-hidden="true" />
      {children}
    </div>
  );
}
