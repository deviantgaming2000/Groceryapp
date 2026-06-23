import { ReactNode } from "react";

/**
 * Slide-in panel: from the right on desktop, slide-up full-width on mobile.
 * Visual-only chrome; renders nothing when closed.
 */
export function SidePanel({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="drawer-head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
