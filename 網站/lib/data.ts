// 音藏 — 示範資料
//
// 四層結構依 產出/20260920_版本資料模型與建檔框架.md：
//   音樂人 → 作品 → 版本 → 個人收藏品
//
// 這裡是階段 0 的示範資料，全部虛構，不是正式內容。
// 欄位命名對齊 產出/20260920_收藏版本建檔測試.xlsx 的 33 欄。

export type DataStatus = "已確認" | "待確認" | "有爭議";

export type Artist = {
  slug: string;
  name: string;
  /** 一句話介紹，歌手頁用 */
  summary: string;
  intro: string;
  formedYear: string;
  origin: string;
  /** 入圍與得獎紀錄，與官方合輯收錄分開記 */
  awards: { year: string; award: string; category: string; result: "入圍" | "得獎" }[];
};

export type Work = {
  slug: string;
  artistSlug: string;
  title: string;
  /** 作品類型：專輯、EP、單曲、現場錄音、影像 */
  workType: string;
  firstReleaseYear: string;
  intro: string;
  /** 發行脈絡，作品頁正文 */
  context: string;
};

export type Version = {
  slug: string;
  workSlug: string;
  /** 版本名，例如「首批紙套版」 */
  edition: string;
  versionType: string;
  year: string;
  region: string;
  label: string;
  licensor: string;
  catalog: string;
  barcode: string;
  format: string;
  packaging: string;
  contents: string;
  /** Q 欄：怎麼認出這是這個版本。版本頁最重要的欄位 */
  identifyBy: string;
  /** R 欄：為什麼跟其他版本拆開 */
  splitReason: string;
  /** 對應 產出 版本判定規則第幾條 */
  splitRule: string;
  status: DataStatus;
  owners: number;
  wanted: number;
  /** 封面色塊，見 globals.css 的 .cover-* */
  color: string;
};

export type Share = {
  id: string;
  authorName: string;
  initials: string;
  time: string;
  title: string;
  story: string;
  /** 掛在哪個版本上。分享是條目的一部分，不是獨立的河 */
  versionSlug: string;
  /** 分享意圖，決定版式：展示型有照片，提問型沒有 */
  intent: "展示" | "尋找辨識線索" | "尋物中";
  image: boolean;
};

export const FORMAT_CODE: Record<string, string> = {
  CD: "CD",
  黑膠: "LP",
  卡帶: "CS",
  "Blu-ray": "BD",
  DVD: "DVD",
};

export const artists: Artist[] = [
  {
    slug: "mountain-radio",
    name: "山線電台",
    summary: "台中三人編制，作品環繞山線鐵路沿線的地景與夜班車。",
    intro:
      "2014 年在台中成立，早期以自製卡帶在中部的獨立書店寄賣。2018 年的《夜行採集》是第一張正式專輯，2020 年由日本廠牌代理發行，兩個版本的目錄號與背面公司資訊都不一樣，是音藏第一組被完整拆開記錄的版本。",
    formedYear: "2014",
    origin: "台中",
    awards: [
      { year: "2019", award: "金音創作獎", category: "最佳專輯", result: "入圍" },
      { year: "2019", award: "金音創作獎", category: "最佳樂團", result: "入圍" },
    ],
  },
  {
    slug: "tide-highway",
    name: "潮汐公路",
    summary: "西南沿海出身的四人樂團，黑膠發行量少、版本差異大。",
    intro:
      "2016 年成軍，作品多錄於自家工作室。《島嶼低鳴》的透明海藍膠是首批限定，內附小海報，但是否每張都有目前仍在確認。",
    formedYear: "2016",
    origin: "台南",
    awards: [{ year: "2023", award: "金曲獎", category: "最佳樂團", result: "入圍" }],
  },
  {
    slug: "empty-room",
    name: "空房間",
    summary: "只在巡演現場販售實體，幾乎不在通路流通。",
    intro:
      "作品以卡帶為主，多數沒有條碼，靠場次貼紙與手寫編號辨認。這個特性讓它成為版本判定規則裡「無法確認差異是否由官方形成」的典型案例。",
    formedYear: "2015",
    origin: "台北",
    awards: [],
  },
  {
    slug: "before-rain-stops",
    name: "雨停以前",
    summary: "以現場錄音與影像作品為主。",
    intro: "2021 年的《南方現場》是首次影像發行，首批盒裝附場刊。",
    formedYear: "2017",
    origin: "高雄",
    awards: [],
  },
  {
    slug: "faint-signal",
    name: "微光訊號",
    summary: "電子與器樂交界，早期作品多為電台宣傳片。",
    intro: "《凌晨四點》的電台宣傳片從未公開發售，流通量極少，資料仍在確認。",
    formedYear: "2018",
    origin: "台北",
    awards: [],
  },
];

export const works: Work[] = [
  {
    slug: "night-harvest",
    artistSlug: "mountain-radio",
    title: "夜行採集",
    workType: "專輯",
    firstReleaseYear: "2018",
    intro: "山線電台首張正式專輯，共十首，錄於台中舊倉庫改建的工作室。",
    context:
      "2018 年由自家廠牌在台灣首度發行，首批為紙套裝。2020 年日本廠牌取得代理後重新壓片，加上側標並更換背面的公司資訊，目錄號也跟著換掉。兩個版本的曲目相同，但發行關係不同，依版本判定規則第二條拆為兩個獨立條目。",
  },
  {
    slug: "island-hum",
    artistSlug: "tide-highway",
    title: "島嶼低鳴",
    workType: "專輯",
    firstReleaseYear: "2022",
    intro: "潮汐公路第二張專輯，首批發行透明海藍膠。",
    context: "首批黑膠為透明海藍色，內附小海報。是否每張首批都附海報仍在確認中。",
  },
  {
    slug: "tape-memo",
    artistSlug: "empty-room",
    title: "留聲便條",
    workType: "專輯",
    firstReleaseYear: "2017",
    intro: "空房間的巡演限定卡帶，只在現場販售。",
    context:
      "沒有條碼，外盒只有場次貼紙與手寫編號。目前無法確認不同場次的差異是否由官方形成，整組先列為待確認候選版本。",
  },
  {
    slug: "southern-live",
    artistSlug: "before-rain-stops",
    title: "南方現場",
    workType: "現場影像",
    firstReleaseYear: "2021",
    intro: "雨停以前的首次影像發行，收錄 2020 年高雄場全場。",
    context: "首批盒裝版附 32 頁場刊，場刊本身也可獨立建條目。",
  },
  {
    slug: "four-am",
    artistSlug: "faint-signal",
    title: "凌晨四點",
    workType: "EP",
    firstReleaseYear: "2019",
    intro: "微光訊號的四曲 EP。",
    context: "市面流通的多為電台宣傳片，未公開發售，資料仍在確認。",
  },
];

export const versions: Version[] = [
  {
    slug: "tw-first-press",
    workSlug: "night-harvest",
    edition: "首批紙套版",
    versionType: "首批",
    year: "2018",
    region: "台灣",
    label: "山線自製",
    licensor: "山線電台",
    catalog: "ML-018-A",
    barcode: "4712345678901",
    format: "CD",
    packaging: "紙套",
    contents: "CD 一片、歌詞折頁",
    identifyBy:
      "外包裝是紙套不是塑膠盒。背面左下印「山線自製」，目錄號 ML-018-A 在紙套背面右下角，字體較小。",
    splitReason: "與日版的目錄號、發行公司、背面版權文字皆不同。",
    splitRule: "規則二：發行地區、發行公司或授權單位不同",
    status: "已確認",
    owners: 18,
    wanted: 7,
    color: "cover-ink",
  },
  {
    slug: "jp-obi",
    workSlug: "night-harvest",
    edition: "日版附側標",
    versionType: "海外代理",
    year: "2020",
    region: "日本",
    label: "Kanata Records",
    licensor: "山線電台",
    catalog: "MLJP-020",
    barcode: "4988000123456",
    format: "CD",
    packaging: "塑膠盒＋側標",
    contents: "CD 一片、歌詞折頁、日文解說、側標",
    identifyBy:
      "有側標，塑膠盒裝。背面公司資訊改為 Kanata Records，目錄號 MLJP-020。側標常被前持有人丟棄，缺側標時看背面公司資訊與目錄號即可確認。",
    splitReason: "海外代理重新壓片，發行公司與目錄號不同。",
    splitRule: "規則二：發行地區、發行公司或授權單位不同",
    status: "已確認",
    owners: 6,
    wanted: 12,
    color: "cover-red",
  },
  {
    slug: "clear-blue-vinyl",
    workSlug: "island-hum",
    edition: "透明海藍膠",
    versionType: "首批限定",
    year: "2022",
    region: "台灣",
    label: "潮汐公路",
    licensor: "潮汐公路",
    catalog: "TS-022-LP",
    barcode: "4712999000123",
    format: "黑膠",
    packaging: "硬紙封套",
    contents: "黑膠一片、內袋、小海報（是否首批皆附待確認）",
    identifyBy: "膠片透光呈海藍色，非黑色。內袋右下有「1st press」字樣。",
    splitReason: "首批限定壓片顏色與一般版不同，官方明確標示批次。",
    splitRule: "規則三：再版、重製版、紀念版或正式限定版",
    status: "已確認",
    owners: 11,
    wanted: 21,
    color: "cover-blue",
  },
  {
    slug: "tour-cassette",
    workSlug: "tape-memo",
    edition: "巡演限定版",
    versionType: "現場限定",
    year: "2017",
    region: "台灣",
    label: "空房間",
    licensor: "空房間",
    catalog: "待查證",
    barcode: "無條碼",
    format: "卡帶",
    packaging: "透明盒＋場次貼紙",
    contents: "卡帶一卷、手寫編號",
    identifyBy:
      "外盒貼場次貼紙，卡帶 A 面右上有手寫編號。目前無法確認不同場次的貼紙是否由官方統一製作。",
    splitReason: "尚未確認差異是否由官方形成，先列候選版本不併入。",
    splitRule: "規則十：無法確認差異是否由官方形成",
    status: "待確認",
    owners: 3,
    wanted: 9,
    color: "cover-cream",
  },
  {
    slug: "boxed-first",
    workSlug: "southern-live",
    edition: "首批盒裝版",
    versionType: "首批",
    year: "2021",
    region: "台灣",
    label: "雨停以前",
    licensor: "雨停以前",
    catalog: "RB-021-BD",
    barcode: "4712888000456",
    format: "Blu-ray",
    packaging: "紙盒",
    contents: "Blu-ray 一片、32 頁場刊",
    identifyBy: "外盒為紙盒不是標準藍光盒，內含 32 頁場刊。再版移除場刊並改用標準盒。",
    splitReason: "官方包裝與內容物制度性不同。",
    splitRule: "規則四：官方封面、碟面、曲目、包裝或內容物制度性不同",
    status: "已確認",
    owners: 8,
    wanted: 5,
    color: "cover-night",
  },
  {
    slug: "radio-promo",
    workSlug: "four-am",
    edition: "電台宣傳片",
    versionType: "宣傳片",
    year: "2019",
    region: "台灣",
    label: "微光訊號",
    licensor: "微光訊號",
    catalog: "PROMO-04",
    barcode: "無條碼",
    format: "CD",
    packaging: "紙袋",
    contents: "CD-R 一片",
    identifyBy: "碟面印「PROMO 非賣品」，紙袋無印刷。",
    splitReason: "非公開發售品，與市售版的製造與內容皆不同。",
    splitRule: "規則四：官方封面、碟面、曲目、包裝或內容物制度性不同",
    status: "待確認",
    owners: 2,
    wanted: 16,
    color: "cover-signal",
  },
];

export const shares: Share[] = [
  {
    id: "share-1",
    authorName: "小孟",
    initials: "孟",
    time: "今天",
    title: "終於把《夜行採集》的兩個 CD 版本放在一起了",
    story:
      "台灣首批是紙套，日本版多了側標，背面的公司資訊也不一樣。一直以為只是包裝差別，實際擺在一起比才發現目錄號根本不同。",
    versionSlug: "tw-first-press",
    intent: "展示",
    image: true,
  },
  {
    id: "share-2",
    authorName: "阿澤",
    initials: "澤",
    time: "昨天",
    title: "這卷巡演卡帶沒有條碼，要從哪裡認？",
    story:
      "外盒只有場次貼紙和一組手寫編號。先放在待確認，希望有人手上也有一卷，可以拍照一起比對。",
    versionSlug: "tour-cassette",
    intent: "尋找辨識線索",
    image: false,
  },
  {
    id: "share-3",
    authorName: "安琪",
    initials: "安",
    time: "3 天前",
    title: "想找這張透明海藍膠的完整內容物",
    story:
      "手上這張缺了內附小海報。想先確認首批是不是每張都有，再決定要換一張完整的，還是單收海報就好。",
    versionSlug: "clear-blue-vinyl",
    intent: "尋物中",
    image: false,
  },
];

/* ---------- 查詢輔助 ---------- */

export const getArtist = (slug: string) => artists.find((a) => a.slug === slug);
export const getWork = (slug: string) => works.find((w) => w.slug === slug);

export const getVersion = (workSlug: string, versionSlug: string) =>
  versions.find((v) => v.workSlug === workSlug && v.slug === versionSlug);

export const versionsOfWork = (workSlug: string) =>
  versions.filter((v) => v.workSlug === workSlug);

export const worksOfArtist = (artistSlug: string) =>
  works.filter((w) => w.artistSlug === artistSlug);

export const sharesOfVersion = (workSlug: string, versionSlug: string) =>
  shares.filter((s) => {
    const v = getVersion(workSlug, versionSlug);
    return v ? s.versionSlug === v.slug : false;
  });

/** 版本的完整識別碼，因為版本 slug 只在作品內唯一 */
export const versionKey = (v: Version) => `${v.workSlug}/${v.slug}`;

export const versionHref = (v: Version) => `/work/${v.workSlug}/${v.slug}`;
export const workHref = (w: Work) => `/work/${w.slug}`;
export const artistHref = (a: Artist) => `/artist/${a.slug}`;

/** 給分享用：把版本、作品、音樂人一次展開 */
export const expandShare = (share: Share) => {
  const version = versions.find((v) => v.slug === share.versionSlug);
  if (!version) return null;
  const work = getWork(version.workSlug);
  if (!work) return null;
  const artist = getArtist(work.artistSlug);
  if (!artist) return null;
  return { share, version, work, artist };
};

/** 全站搜尋，比對音樂人、作品、版本名與目錄號 */
export const searchVersions = (query: string, format: string) => {
  const q = query.trim().toLowerCase();
  return versions.filter((v) => {
    const work = getWork(v.workSlug);
    const artist = work ? getArtist(work.artistSlug) : undefined;
    const haystack = [artist?.name, work?.title, v.edition, v.catalog, v.barcode]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesQuery = !q || haystack.includes(q);
    const matchesFormat =
      format === "全部" ||
      v.format === format ||
      (format === "影像" && ["DVD", "Blu-ray"].includes(v.format));
    return matchesQuery && matchesFormat;
  });
};
