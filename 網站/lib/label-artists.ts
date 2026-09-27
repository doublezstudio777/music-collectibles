// 顏社、本色音樂旗下藝人：炫收藏表單預設清單的固定池之一（2026-09-28）。
//
// 來源：研究/20260927_顏社本色音樂/藝人.csv，24 位（顏社 16、本色音樂 8）。
// 順序照原始名單：廠牌先後（顏社→本色音樂），廠牌內現任在前、前藝人在後。
// 不從資料庫欄位（tagline、source）推導，因為那兩欄之後可能被人手動改動；
// 這份名單本身異動很少（廠牌旗下藝人變化不頻繁），異動時直接改這個陣列。
//
// 用途：Catalog.formArtistPool()——炫收藏表單「跟誰有關」的預設清單其中一段，
// 排在全站最近有人發過收藏的藝人之後（見 lib/catalog.ts 的說明）。
export const LABEL_FORCE_SLUGS = [
  // 顏社（16 位，現任 9 位在前，前藝人 7 位在後）
  "gordon",
  "li-quan-zhe",
  "chunyan",
  "wan-zhi-xuan",
  "dj-mr-gin",
  "zhao-yi-fan",
  "chen-xian-jing",
  "fang-pin-rong",
  "yeemao",
  "soft-lipa",
  "san-xiao-tang",
  "sowut",
  "ji-tui-fan",
  "li-ying-hong",
  "leo",
  "miss-ko",
  // 本色音樂（8 位，現任 7 位在前，前藝人 1 位在後）
  "mj116",
  "double-j",
  "muta",
  "kenzy",
  "e-so",
  "mc-hotdog",
  "zhang-zhen-yue",
  "guts",
] as const;
