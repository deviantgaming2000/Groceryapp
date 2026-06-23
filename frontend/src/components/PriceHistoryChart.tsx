import { useState } from "react";
import { money } from "../lib/api";

export interface PricePoint {
  date: string | Date;
  price: number;
  store?: string;
}

const W = 620;
const H = 240;
const PAD = { l: 50, r: 16, t: 18, b: 34 };

function shortDate(d: string | Date) {
  return new Date(d).toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
}

export function PriceHistoryChart({ points, unit }: { points: PricePoint[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const data = points
    .map((p) => ({ ...p, t: new Date(p.date).getTime(), price: Number(p.price) }))
    .filter((p) => isFinite(p.t) && isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.t - b.t);

  if (data.length === 0) {
    return (
      <div className="chart-empty">
        <strong>No price history yet</strong>
        <p>Record this item's price over time (or refresh a linked store price) and the trend will appear here.</p>
      </div>
    );
  }

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const n = data.length;

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const xAt = (i: number) => PAD.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (price: number) => PAD.t + (1 - (price - min) / span) * innerH;

  const minIdx = prices.indexOf(min);
  const maxIdx = prices.indexOf(max);
  const curIdx = n - 1;
  const current = data[curIdx];
  const stores = [...new Set(data.map((d) => d.store).filter(Boolean))] as string[];

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(d.price).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xAt(n - 1).toFixed(1)},${PAD.t + innerH} L${xAt(0).toFixed(1)},${PAD.t + innerH} Z`;

  return (
    <div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="price-chart" role="img" aria-label="Price history">
          <defs>
            <linearGradient id="ph-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ph-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--brand1)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
          </defs>

          {/* y gridlines at min / max */}
          {[min, max].map((p, i) => (
            <g key={i}>
              <line x1={PAD.l} y1={yAt(p)} x2={W - PAD.r} y2={yAt(p)} className="chart-grid" />
              <text x={PAD.l - 8} y={yAt(p) + 4} textAnchor="end" className="chart-axis">{money(p)}</text>
            </g>
          ))}

          {n > 1 && <path d={areaPath} fill="url(#ph-area)" />}
          {n > 1 && <path d={linePath} fill="none" stroke="url(#ph-line)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}

          {data.map((d, i) => {
            const isMin = i === minIdx;
            const isMax = i === maxIdx;
            const isCur = i === curIdx;
            const cls = isCur ? "dot dot-cur" : isMin ? "dot dot-min" : isMax ? "dot dot-max" : "dot";
            return (
              <circle
                key={i}
                cx={xAt(i)}
                cy={yAt(d.price)}
                r={hover === i ? 6 : isCur || isMin || isMax ? 5 : 3.5}
                className={cls}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                <title>{`${d.store ? d.store + " · " : ""}${money(d.price)} · ${shortDate(d.date)}`}</title>
              </circle>
            );
          })}

          {/* x-axis: first & last date */}
          <text x={xAt(0)} y={H - 10} textAnchor="start" className="chart-axis">{shortDate(data[0].date)}</text>
          {n > 1 && <text x={xAt(n - 1)} y={H - 10} textAnchor="end" className="chart-axis">{shortDate(current.date)}</text>}
        </svg>

        {hover !== null && (
          <div
            className="chart-tip"
            style={{ left: `${(xAt(hover) / W) * 100}%`, top: `${(yAt(data[hover].price) / H) * 100}%` }}
          >
            <strong>{money(data[hover].price)}</strong>
            <span>{data[hover].store || "—"}</span>
            <span>{shortDate(data[hover].date)}</span>
          </div>
        )}
      </div>

      <div className="chart-stats">
        <div><span>Current</span><strong style={{ color: "var(--accent)" }}>{money(current.price)}{unit ? `/${unit}` : ""}</strong></div>
        <div><span>Lowest</span><strong style={{ color: "#8ff0c2" }}>{money(min)}</strong></div>
        <div><span>Highest</span><strong style={{ color: "var(--error)" }}>{money(max)}</strong></div>
      </div>
      <p className="chart-meta">
        {stores.length === 1 ? stores[0] : `${stores.length} stores`} · {n} data point{n === 1 ? "" : "s"} · last updated {shortDate(current.date)}
        {n < 2 && " · not enough history yet to show a trend"}
      </p>
    </div>
  );
}
