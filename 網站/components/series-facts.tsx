// 系列頁的版本比較表與站上行情（2026-10-01 系列頁全部收錄）。伺服器元件，資料由 lib/server/seo.ts 的 seriesFacts／seriesMarket 算好。
//
// 版本比較表（全域規則：列高一致、欄寬固定、不截斷）：
// - 每格不換行（white-space: nowrap），所以每列都是一行高；欄寬由伺服器依該欄最長的字估出來（中日韓字 1em、其他 .64em），
//   table-layout: fixed＋<col> 寬度，字一定放得下；表比畫面寬就整張橫捲，第一欄（版本名）固定在左邊
// - 目錄號、條碼是登入後才看得到的辨識細節，不放這裡
// 站上行情：data-nosnippet，價格不進搜尋結果摘要；也不出 Product／Offer 結構化資料（2026-10-01 使用者決定）

import { priceText } from "@/lib/data";
import type { MarketFacts, VersionFact } from "@/lib/series-intro";

type Col = { key: string; label: string; get: (v: VersionFact) => string; mono?: boolean };

// 2026-10-02 設計總檢（必修 5、7，建議 18）：品項裡的多欄比較表拿掉，欄位併到這一張；發行日用台灣寫法 2017/4/24（之後再說 4）；
// 「資料狀態」「曲目差異」這類內部欄位不給訪客看，曲目差異改寫在各版本的曲目區
const COLS: Col[] = [
  { key: "edition", label: "版本", get: (v) => v.edition },
  { key: "region", label: "發行地區", get: (v) => v.region },
  { key: "year", label: "發行", get: (v) => v.releaseDate || v.year, mono: true },
  { key: "label", label: "唱片公司", get: (v) => v.label },
  { key: "format", label: "格式", get: (v) => v.format || v.kind },
  { key: "discs", label: "片數", get: (v) => (v.discs ? String(v.discs) : ""), mono: true },
  { key: "tracks", label: "曲目", get: (v) => (v.trackCount ? `${v.trackCount} 首` : ""), mono: true },
  { key: "packaging", label: "包裝", get: (v) => v.packaging },
];
// 內容物是自由填的長文字，放進不換行的表會把整張表撐到要橫捲，改寫在各版本段落的標題下（page.tsx VersionBlock）

/** 估字寬（em）：中日韓字與全形標點 1em，其他字元 .64em（Inter 大寫最寬約 .7、小寫數字約 .55，取偏寬的值寧可多留白） */
function emWidth(s: string, mono = false) {
  let w = 0;
  for (const ch of s) w += /[\u0000-ɏ]/.test(ch) ? (mono ? 0.62 : 0.64) : 1;
  return w;
}

export function VersionTable({ versions }: { versions: VersionFact[] }) {
  if (!versions.length) return null;
  // 所有版本都沒值的欄不畫（版本欄一定畫）
  const cols = COLS.filter((c) => c.key === "edition" || versions.some((v) => c.get(v)));
  // 欄寬：表頭與每格的最長字＋左右內距 1.6em（14px 字 → 左右各約 11px），最少 3.6em
  const widths = cols.map((c) => Math.max(3.6, Math.ceil((Math.max(emWidth(c.label), ...versions.map((v) => emWidth(c.get(v), c.mono))) + 1.8) * 10) / 10));
  const total = widths.reduce((a, b) => a + b, 0);
  return (
    <section className="block ver-compare" id="versions" data-testid="version-table">
      <h2 className="block-title">
        版本比較<span className="count">{versions.length}</span>
      </h2>
      {total > 22 ? (
        <p className="ver-table-hint" aria-hidden="true">
          左右滑動看更多欄位 →
        </p>
      ) : null}
      <div className="ver-table-scroll" tabIndex={0} role="region" aria-label="版本比較表，可左右捲動">
        {/* 至少撐滿內容寬（建議 19：桌機三塊右緣對齊）；比畫面寬就照估的字寬橫捲 */}
        <table className="ver-table ver-table-full" style={{ width: `max(100%, ${total}em)` }}>
          <colgroup>
            {cols.map((c, i) => (
              <col key={c.key} style={{ width: `${widths[i]}em` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.anchor}>
                {cols.map((c) =>
                  c.key === "edition" ? (
                    <th key={c.key} scope="row">
                      <a className="link" href={`#${v.anchor}`}>
                        {v.edition}
                      </a>
                    </th>
                  ) : (
                    <td key={c.key} className={c.mono ? "mono" : undefined}>
                      {c.get(v) || "—"}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const rangeText = (r: [number, number]) => (r[0] === r[1] ? priceText(r[0]) : `${priceText(r[0])}～${priceText(r[1])}`);

export function MarketBox({ market }: { market: MarketFacts | null }) {
  if (!market) return null;
  return (
    <section className="block market" id="market" data-testid="series-market" data-nosnippet="">
      <h2 className="block-title">站上行情</h2>
      <dl className="market-stats">
        <div>
          <dt>出售中</dt>
          <dd>
            <span className="num" data-testid="market-on-sale">
              {market.onSale}
            </span>{" "}
            件
          </dd>
        </div>
        {market.asks ? (
          <div>
            <dt>開價</dt>
            <dd className="num" data-testid="market-asks">
              {rangeText(market.asks)}
            </dd>
          </div>
        ) : null}
        {market.lastSold ? (
          <div>
            <dt>最近成交</dt>
            <dd data-testid="market-last-sold">
              <span className="num">{priceText(market.lastSold.price)}</span>
              {market.lastSold.date ? <span className="sub market-date">{market.lastSold.date}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
