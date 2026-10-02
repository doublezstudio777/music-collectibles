// 新手指南正文（2026-09-29）：/guide 頁與個人頁「新手指南」對話框共用同一份。
// 正文照 產出/20260929_新手指南/文案草稿_v3.md（站名讀 SITE_NAME）；2026-10-02 設計總檢建議 2、15：必填用詞跟表單一致（照片、誰的東西、是什麼），
// 補合集、一次發多張、願望清單、私訊四段，操作示意圖用現行介面重截（產出/20261002_顧問總檢/配圖/）；兩張表的數字一律從程式常數產生
// （lib/levels.ts、lib/score-rules.ts），規則改了這裡跟著變。圖只是視覺輔助，表格才是可讀取的資料。
import Link from "@/components/link";
import { SITE_NAME } from "@/lib/data";
import { feedbackHref } from "@/lib/feedback";
import { LEVELS, TIERS } from "@/lib/levels";
import { BIG_CHARS, CAPS, POINTS, TITLE_FAKEBUSTER_MIN } from "@/lib/score-rules";

const n = (x: number) => x.toLocaleString("en-US");
const pts = (x: number) => (x < 0 ? `−${Math.abs(x)}` : `+${x}`);

/** 得分方式：[項目, 分數, 每日上限] */
export const POINT_ROWS: [string, string, string][] = [
  ["編輯藝人頁、專輯頁", `${pts(POINTS.edit)}；單次 ${BIG_CHARS} 字以上 ${pts(POINTS.editBig)}`, "無"],
  ["新增藝人、專輯、品項、版本", pts(POINTS.create), "無"],
  ["藝人照片獲採用", pts(POINTS.create), "無"],
  ["發布收藏", pts(POINTS.share), `${CAPS.shareDay} 則`],
  ["補上空白資料", pts(POINTS.fill), `${CAPS.fillDay} 次`],
  ["檢舉成立", pts(POINTS.reportOk), "無"],
  ["檢舉不成立", pts(POINTS.reportBad), "無"],
  ["成交", pts(POINTS.deal), "無"],
  ["留言", pts(POINTS.comment), `${CAPS.commentDay} 則`],
  ["按讚", pts(POINTS.likeGive), `${CAPS.likeGiveDay} 次`],
  ["收到讚、收到留言", pts(POINTS.likeRecv), `每則收藏各 ${CAPS.likeRecvPerShare}`],
];

const range = (t: number) => `${TIERS[t]} ${n(LEVELS[t * 5])}～${n(LEVELS[t * 5 + 4])} 分`;

/** 桌機、手機兩版的圖：640px 以下換手機版；兩版都附 2x */
function Pic({ desk, mobile, alt }: { desk: { src: string; w: number; h: number }; mobile?: { src: string; w: number; h: number }; alt: string }) {
  const set = (src: string, w: number) => `/guide/${src}.webp ${w}w, /guide/${src}@2x.webp ${w * 2}w`;
  return (
    <figure className="guide-fig">
      <picture>
        {mobile ? <source media="(max-width: 640px)" srcSet={set(mobile.src, mobile.w)} sizes="100vw" width={mobile.w} height={mobile.h} /> : null}
        <img
          src={`/guide/${desk.src}.webp`}
          srcSet={set(desk.src, desk.w)}
          sizes={desk.w <= 750 ? "(max-width: 640px) 100vw, 375px" : "(max-width: 760px) 100vw, 680px"}
          width={desk.w}
          height={desk.h}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={desk.w <= 750 ? "guide-img guide-img-phone" : "guide-img"}
          data-guide-img={desk.src}
        />
      </picture>
    </figure>
  );
}

export function GuideContent({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="guide prose" data-testid="guide-content">
      <section id="share" className="guide-sec">
        <H>炫收藏</H>
        <ul>
          <li>照片：1～10 張，第一張為封面；只能放自己拍的照片</li>
          <li>拍照前看一下背景，別拍到住家窗外、收件人姓名地址、實名票券上的個人資料</li>
          <li>必填：照片、誰的東西、是什麼</li>
          <li>選填：專輯或演唱會、版本、想說的話、標籤、要不要賣</li>
          <li>發布後可編輯</li>
        </ul>
        <Pic desk={{ src: "howto-share", w: 750, h: 1947 }} alt="操作示意：1 炫收藏、2 加照片、3 選藝人、4 選品項、5 發布" />
      </section>

      <section id="batch" className="guide-sec">
        <H>一次發多張、發合集</H>
        <ul>
          <li>藝人頁按「我收藏了哪些」，勾選你有的版本；勾好按「一起發文」，每張各自一則</li>
          <li>「發合集」是一張合集照片標很多張專輯：上傳合集照片，標記裡面有哪些專輯，可以在照片上標號碼</li>
          <li>合集不能交易，要賣就從合集頁「挑幾張單獨發文」</li>
        </ul>
      </section>

      <section id="wish" className="guide-sec">
        <H>願望清單</H>
        <ul>
          <li>系列頁的版本旁按愛心「加入願望清單」，收藏卡片的愛心也進同一份清單</li>
          <li>頁首的愛心打開願望清單；有人在賣的版本會標「有 N 件出售中」並排在最前面</li>
          <li>個人頁公開的是想要的版本，按愛心的收藏不公開</li>
        </ul>
      </section>

      <section id="contribute" className="guide-sec">
        <H>補資料</H>
        <ul>
          <li>藝人頁、專輯頁可編輯，需登入並完成 Email 驗證</li>
          <li>可編輯項目：簡介、發行年、曲目、版本、目錄號</li>
          <li>每次修改保留紀錄，可還原</li>
        </ul>
        <Pic desk={{ src: "howto-edit", w: 750, h: 1619 }} alt="操作示意：1 編輯、2 修改、3 儲存" />
      </section>

      <section id="trade" className="guide-sec">
        <H>買賣</H>
        <ul>
          <li>出售方式：純分享、開放出價、定價出售</li>
          <li>限台灣地區</li>
          <li>{SITE_NAME}不經手款項與商品，成交後由買賣雙方自行交付</li>
          <li>「我要買」「出價」「拒絕」「成交給這位」都會先確認一次才送出</li>
        </ul>
      </section>

      <section id="dm" className="guide-sec">
        <H>私訊</H>
        <ul>
          <li>出售中的收藏按「問賣家」，純分享的按「私訊」，個人頁按「傳訊息」；頁首的對話框圖示打開私訊列表</li>
          <li>驗證 Email 後才能傳訊息</li>
          <li>對話頂端可以封鎖或檢舉對方；管理員看不到訊息內容</li>
        </ul>
      </section>

      <section id="report" className="guide-sec">
        <H>回報</H>
        <ul>
          <li>入口：收藏頁底部「對這則收藏有疑問嗎？」</li>
          <li>資料有誤、非此藝人、重複發文：由站長修正</li>
          <li>疑似盜版、疑似詐騙、內容不妥：檢舉人數達門檻即暫停交易，由站長查證</li>
        </ul>
        <Pic desk={{ src: "howto-report", w: 750, h: 1970 }} alt="操作示意：1 對這則收藏有疑問嗎？、2 選原因、3 送出" />
      </section>

      <section id="levels" className="guide-sec">
        <H>等級與稱號</H>
        <p>稱號五階，每階 Lv.1～5。</p>
        <Pic
          desk={{ src: "levels-desktop", w: 1200, h: 553 }}
          mobile={{ src: "levels-mobile", w: 750, h: 898 }}
          alt={`等級階梯：${TIERS.map((_, t) => range(t)).join("、")}`}
        />
        <div className="tbl-scroll">
          <table className="tbl guide-table" data-testid="guide-levels">
            <thead>
              <tr>
                <th scope="col">稱號</th>
                {[1, 2, 3, 4, 5].map((lv) => (
                  <th key={lv} scope="col" className="num">
                    Lv.{lv}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIERS.map((tier, t) => (
                <tr key={tier}>
                  <th scope="row">{tier}</th>
                  {LEVELS.slice(t * 5, t * 5 + 5).map((v, i) => (
                    <td key={i} className="num">
                      {n(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pic
          desk={{ src: "points-desktop", w: 1200, h: 780 }}
          mobile={{ src: "points-mobile", w: 750, h: 1051 }}
          alt={`得分方式：${POINT_ROWS.map((r) => `${r[0]} ${r[1]}`).join("、")}`}
        />
        <div className="tbl-scroll">
          <table className="tbl guide-table" data-testid="guide-points">
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col">分數</th>
                <th scope="col">每日上限</th>
              </tr>
            </thead>
            <tbody>
              {POINT_ROWS.map((r) => (
                <tr key={r[0]}>
                  <th scope="row">{r[0]}</th>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul>
          <li>新增藝人、專輯、版本的分數立即入帳；日後遭合併或刪除時扣回</li>
          <li>編輯、檢舉的分數於 7 天後入帳；期間內遭還原或翻案者不計</li>
          <li>分數每日凌晨統計</li>
        </ul>
        <div id="titles">
          <p>特別稱號：</p>
          <ul>
            <li>打假先鋒：檢舉成立累計 {TITLE_FAKEBUSTER_MIN} 次</li>
            <li>頭號樂迷：該藝人頁面有效編輯次數最多者</li>
          </ul>
          <Pic desk={{ src: "titles", w: 600, h: 600 }} alt={`特別稱號：打假先鋒，檢舉成立累計 ${TITLE_FAKEBUSTER_MIN} 次；頭號樂迷，該藝人頁面有效編輯次數最多者；館長，站長帳號`} />
        </div>
        <p>站長帳號顯示「館長」。</p>
      </section>

      <section id="upcoming" className="guide-sec">
        <H>開發中</H>
        <p>更多功能開發中</p>
      </section>

      <section id="feedback" className="guide-sec">
        <H>意見回饋</H>
        <p>
          問題與建議請填<Link href={feedbackHref()}>意見回饋表單</Link>
        </p>
      </section>
    </div>
  );
}
