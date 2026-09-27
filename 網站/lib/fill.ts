// 補上缺漏資料（2026-09-28 擴大）：前後端共用的欄位清單與「空白」判定。

/**
 * 版本可補的欄位：原本空白、補上後資料更完整的都算。
 * 條碼不在內：預設值「無條碼」分不出是沒填還是真的沒有條碼。資料狀態由管理員判定，不算缺漏。
 * public＝公開頁面顯示的欄位；目錄號、辨識特徵屬於辨識細節，登入後才看得到，也在那裡補。
 */
export const FILL_FIELDS = {
  year: { label: "發行年", col: "year", max: 4, public: true },
  region: { label: "地區", col: "region", max: 40, public: true },
  label: { label: "發行", col: "label", max: 80, public: true },
  packaging: { label: "包裝", col: "packaging", max: 120, public: true },
  contents: { label: "內容物", col: "contents", max: 500, public: true },
  tracks: { label: "曲目", col: "tracks", max: 1000, public: true },
  catalog: { label: "目錄號", col: "catalog", max: 40, public: false },
  identifyBy: { label: "辨識特徵", col: "identify_by", max: 500, public: false },
} as const;
export type FillField = keyof typeof FILL_FIELDS;

/** 欄位算不算空白（跟頁面上「只列有值的欄位」同一套；發行年要四位數才算有值） */
export const isBlank = (field: string, v: string | null | undefined) => {
  const x = (v ?? "").trim();
  if (field === "year") return !/^\d{4}/.test(x);
  return !x || x === "—" || x === "待查證";
};
