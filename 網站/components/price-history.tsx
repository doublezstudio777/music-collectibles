import { priceText } from "@/lib/data";
import type { PriceSummary } from "@/lib/prices";

const W = 240;
const H = 56;

/** 走勢：舊到新的成交價折線，SVG 手畫（不裝圖表套件） */
function Trend({ points }: { points: PriceSummary["points"] }) {
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const x = (i: number) => (points.length === 1 ? W / 2 : 4 + (i * (W - 8)) / (points.length - 1));
  const y = (p: number) => (hi === lo ? H / 2 : 4 + ((hi - p) * (H - 8)) / (hi - lo));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`成交走勢：${points.map((p) => `${p.date} ${priceText(p.price)}`).join("、")}`}>
      <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--line)" />
      <path d={d} fill="none" stroke="var(--text)" strokeWidth="1.5" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i).toFixed(1)} cy={y(p.price).toFixed(1)} r="2.5" fill="var(--text)" />
      ))}
    </svg>
  );
}

const rangeText = (r: [number, number]) => (r[0] === r[1] ? priceText(r[0]) : `${priceText(r[0])}～${priceText(r[1])}`);

/** 版本區塊的成交行情。不足 3 筆時整塊不出現（呼叫端拿不到 summary） */
export function PriceHistory({ summary }: { summary: PriceSummary }) {
  const first = summary.points[0].date;
  const last = summary.points[summary.points.length - 1].date;
  return (
    <div className="price-hist" data-testid="price-history">
      <h4 className="sub-title">成交行情</h4>
      <div className="price-grid">
        <dl className="price-stats">
          <div>
            <dt>近期成交</dt>
            <dd className="num">{rangeText([summary.min, summary.max])}</dd>
          </div>
          <div>
            <dt>中間值</dt>
            <dd className="num" data-testid="price-median">
              {priceText(summary.median)}
            </dd>
          </div>
          <div>
            <dt>目前開價</dt>
            <dd className="num">{summary.asks ? rangeText(summary.asks) : "—"}</dd>
          </div>
          <div>
            <dt>目前出價</dt>
            <dd className="num">{summary.bids ? rangeText(summary.bids) : "—"}</dd>
          </div>
        </dl>
        <figure className="price-trend">
          <Trend points={summary.points} />
          <figcaption className="sub">
            <span className="num" data-testid="price-n">
              {summary.n}
            </span>{" "}
            筆 · <span className="mono">{first}</span>～<span className="mono">{last}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
