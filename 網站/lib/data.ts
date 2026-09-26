// 音藏 — 示範資料（全部虛構，不是正式內容）
//
// 結構依 討論/20260923_Claude_企劃四項與命名決策.md（含 9/24、9/25 追加定案）：
//   藝人（含發行單位）→ 系列（一次發行或一場活動；網址掛在發行方底下，流水號）
//   → 品項（CD、卡帶、毛巾…，系列頁錨點 #cd）→ 版本（錨點 #cd-v1）→ 個人收藏
//   炫收藏：跟誰有關＋系列＋品項＋版本（可不確定）＋照片（2026-09-26 系列層定案）
//
// 幾條規則寫在資料層，頁面不自己判斷：
// - 共同署名系列：credits 列出所有署名藝人，每位的藝人頁都列為主要作品；資料只有一筆
// - 合作與客串、合輯收錄另外記，不算進對方的主要作品
// - 標籤與藝人名（或別名）撞名時，resolveTagArtist 會找到那位藝人，標籤頁與藝人頁的
//   「相關收藏」用同一份資料
// - 讚數、我有、想要的數字是「其他人」的量，目前使用者自己的狀態由 lib/state.tsx 疊上去

export type DataStatus = "已確認" | "待確認" | "有爭議";

export type ArtistGender = "male" | "female" | "group";
export type ArtistRegion = "domestic" | "overseas";
export const GENDER_LABEL: Record<ArtistGender, string> = { male: "男歌手", female: "女歌手", group: "團體" };
export const REGION_LABEL: Record<ArtistRegion, string> = { domestic: "國內", overseas: "國外" };

/*
 * 物件類型（2026-09-26 定案改點選）：表單、商品卡、單則頁用同一套名字。
 * 示範資料裡原本自由填的類型，由 normKind 對到這一套；對不到的歸「其他周邊」並保留原字當補充。
 */
export const KINDS = ["CD", "黑膠", "卡帶", "藍光／DVD", "毛巾", "T 恤", "海報", "場刊", "其他周邊"] as const;
export type Kind = (typeof KINDS)[number];
const KIND_ALIAS: Record<string, Kind> = {
  "CD-R": "CD", 藍光: "藍光／DVD", "Blu-ray": "藍光／DVD", DVD: "藍光／DVD", T恤: "T 恤",
};
export const normKind = (raw: string): { kind: Kind; note?: string } => {
  if (!raw) return { kind: "其他周邊" };
  if ((KINDS as readonly string[]).includes(raw)) return { kind: raw as Kind };
  if (KIND_ALIAS[raw]) return { kind: KIND_ALIAS[raw], note: raw === "CD-R" ? raw : undefined };
  return { kind: "其他周邊", note: raw };
};

export type Artist = {
  /** 網址識別碼：英文名或音譯，小寫、連字號 */
  slug: string;
  name: string;
  /** 撞名比對用：英文名、常見寫法 */
  aliases: string[];
  kind: "藝人" | "發行單位";
  /** 表單分類用：男歌手／女歌手／團體；發行單位不分 */
  gender?: ArtistGender;
  /** 表單分類用：國內／國外 */
  region?: ArtistRegion;
  /** 名字下面那一行定位 */
  tagline: string;
  intro: string[];
  awards: { year: string; award: string; category: string; result: "入圍" | "得獎" }[];
  lastEdit: { by: string; date: string };
};

export type Version = {
  /** 品項內的編號，v1、v2…；錨點是 #{品項}-{v1} */
  id: string;
  edition: string;
  year: string;
  region: string;
  label: string;
  catalog: string;
  barcode: string;
  packaging: string;
  contents: string;
  tracks: string;
  /** 辨識特徵，比較表第一列 */
  identifyBy: string;
  /** 正版辨識：逐項特徵，photo 是照片說明（示範用灰色塊代替） */
  marks?: Mark[];
  /** 已知仿冒 */
  fakes?: Fake[];
  status: DataStatus;
  /** 其他人的我有／想要人數 */
  owners: number;
  wanted: number;
  color: string;
};

export type Mark = { label: string; text: string; photo?: string };
export type Fake = {
  name: string;
  /** 在哪裡出現過 */
  seen: string;
  rows: { label: string; genuine: string; fake: string }[];
};

/** 品項：同一系列裡的一種東西（CD、卡帶、毛巾…），錨點 #cd */
export type Item = {
  id: string;
  kind: Kind;
  versions: Version[];
};

/** 系列：一次發行或一場活動。網址 /artist/{發行方}/{流水號}，品項與版本用錨點 */
export type Series = {
  /** 網址掛在誰底下：發行方 */
  artistSlug: string;
  /** 發行方底下的流水號，永不重用 */
  no: number;
  /** 短名，卡片與連結用 */
  title: string;
  /** 全名：2018《夜行採集》專輯發行 */
  name: string;
  /** 專輯發行、巡迴演唱會、音樂祭… */
  seriesType: string;
  /** 共同署名：每位都列主要系列 */
  credits: string[];
  year: string;
  body: string[];
  /** 合作與客串：不算對方的主要系列 */
  guests: { artistSlug: string; role: string; track: string }[];
  /** 合輯收錄 */
  compilation: { artistSlug: string; track: string }[];
  items: Item[];
  lastEdit: { by: string; date: string };
};

/** 出售狀態：純分享（預設）／開放出價／定價出售／已售出。錢貨不經過平台，成交後雙方自己約 */
export type SaleState = "share" | "offer" | "sale" | "sold";

export type Sale = {
  state: SaleState;
  /** 定價出售的價格；已售出時是原本的標價 */
  price?: number;
  /** 已售出：成交價、成交對象、成交時間 */
  soldPrice?: number;
  soldTo?: string;
  soldAt?: string;
};

export type Share = {
  n: number;
  author: string;
  time: string;
  /** 越大越新，排序用 */
  order: number;
  /** 是什麼東西（必填） */
  what: string;
  /** 物件類型，自由字串，封面色塊右下角那個字 */
  kind: string;
  story: string;
  /** 跟誰有關（必填，至少一個） */
  about: string[];
  tags: string[];
  /** 其他人的讚數 */
  likes: number;
  color: string;
  image?: string;
  link?: { series: string; item?: string; version?: string };
  sale?: Sale;
  /** 發文者同意照片當辨識參考 */
  refPhoto?: boolean;
};

export type User = {
  handle: string;
  name: string;
  initials: string;
  bio: string;
  /** 版本鍵：`{藝人}/{流水號}#v1` */
  owned: string[];
  wanted: string[];
  liked: number[];
  /** 認證帳號才能檢舉 */
  verified: boolean;
  /** 追蹤的藝人 slug */
  follows: string[];
};

/** 沒有帳號系統前，示範用的登入者 */
export const CURRENT_USER = "xiaomeng";

export const artists: Artist[] = [
  {
    slug: "mountain-radio",
    name: "山線電台",
    aliases: ["Mountain Radio"],
    kind: "藝人",
    gender: "group",
    region: "domestic",
    tagline: "台中三人樂團，2014 年至今",
    intro: [
      "2014 年在台中成立，早期以自製卡帶在中部的獨立書店寄賣。2018 年的《夜行採集》是第一張正式專輯，2020 年由日本廠牌 Kanata Records 代理發行，日版加了側標並更換背面的公司資訊。",
      "作品環繞山線鐵路沿線的地景與夜班車，主唱兼吉他手曾在鐵路局擔任夜班站務。",
    ],
    awards: [
      { year: "2019", award: "金音創作獎", category: "最佳專輯《夜行採集》", result: "入圍" },
      { year: "2019", award: "金音創作獎", category: "最佳樂團", result: "入圍" },
    ],
    lastEdit: { by: "阿澤", date: "2026-09-20" },
  },
  {
    slug: "tide-highway",
    name: "潮汐公路",
    aliases: ["Tide Highway"],
    kind: "藝人",
    gender: "group",
    region: "domestic",
    tagline: "台南四人樂團，2016 年至今",
    intro: [
      "2016 年成軍，作品多錄於自家工作室，黑膠發行量少、版本差異大。《島嶼低鳴》的首批透明海藍膠內附小海報，是否每張都有仍在確認。",
      "2024 年與山線電台共同署名發行 EP《海線對話》，由潮汐公路的自家廠牌發行。",
    ],
    awards: [{ year: "2023", award: "金曲獎", category: "最佳樂團", result: "入圍" }],
    lastEdit: { by: "安琪", date: "2026-09-18" },
  },
  {
    slug: "empty-room",
    name: "空房間",
    aliases: ["Empty Room"],
    kind: "藝人",
    gender: "male",
    region: "domestic",
    tagline: "台北創作者，2015 年至今，只在巡演現場賣實體",
    intro: [
      "作品以卡帶為主，多數沒有條碼，靠場次貼紙與手寫編號辨認。",
    ],
    awards: [],
    lastEdit: { by: "阿澤", date: "2026-09-12" },
  },
  {
    slug: "before-rain-stops",
    name: "雨停以前",
    aliases: ["Before Rain Stops"],
    kind: "藝人",
    gender: "group",
    region: "domestic",
    tagline: "高雄樂團，2017 年至今，以現場錄音與影像為主",
    intro: ["2021 年的《南方現場》是首次影像發行，首批盒裝附 32 頁場刊，再版移除場刊並改用標準盒。"],
    awards: [],
    lastEdit: { by: "阿哲", date: "2026-09-10" },
  },
  {
    slug: "faint-signal",
    name: "微光訊號",
    aliases: ["Faint Signal"],
    kind: "藝人",
    gender: "group",
    region: "domestic",
    tagline: "台北電子器樂雙人組，2018 年至今",
    intro: ["《凌晨四點》的電台宣傳片從未公開發售，流通量極少。"],
    awards: [],
    lastEdit: { by: "rin", date: "2026-09-08" },
  },
  {
    slug: "harbor-fest",
    name: "海港音樂祭",
    aliases: ["Harbor Fest"],
    kind: "發行單位",
    tagline: "高雄年度戶外音樂祭，2012 年起",
    intro: ["每年發行一張現場精選合輯，場刊另外販售。2019 年場刊第 14 頁收錄山線電台專訪。"],
    awards: [],
    lastEdit: { by: "安琪", date: "2026-09-15" },
  },
  {
    slug: "lin-hsia",
    name: "林夏",
    aliases: ["Lin Hsia"],
    kind: "藝人",
    gender: "female",
    region: "domestic",
    tagline: "花蓮創作歌手，2019 年至今",
    intro: ["木吉他自彈自唱，實體只做過手工裝訂的 CD 與演出毛巾。"],
    awards: [],
    lastEdit: { by: "安琪", date: "2026-09-19" },
  },
  {
    slug: "haruka-mori",
    name: "森遙",
    aliases: ["Haruka Mori"],
    kind: "藝人",
    gender: "female",
    region: "overseas",
    tagline: "大阪創作歌手，2012 年至今",
    intro: ["台灣代理版與日本原版的側標、歌詞翻譯都不同，常被拿來比對。"],
    awards: [],
    lastEdit: { by: "rin", date: "2026-09-17" },
  },
  {
    slug: "kenji-arai",
    name: "新井健次",
    aliases: ["Kenji Arai"],
    kind: "藝人",
    gender: "male",
    region: "overseas",
    tagline: "東京創作歌手，2008 年至今",
    intro: ["來台巡演三次，每次都有台灣限定的毛巾與海報。"],
    awards: [],
    lastEdit: { by: "rin", date: "2026-09-16" },
  },
  {
    slug: "grey-pier",
    name: "灰色碼頭",
    aliases: ["Grey Pier"],
    kind: "藝人",
    gender: "group",
    region: "overseas",
    tagline: "香港四人樂團，2015 年至今",
    intro: ["黑膠只在香港本地唱片行發售，台灣流通的多是轉賣。"],
    awards: [],
    lastEdit: { by: "阿澤", date: "2026-09-14" },
  },
];

const V = (v: Partial<Version> & Pick<Version, "id" | "edition" | "year">): Version => ({
  region: "台灣",
  label: "",
  catalog: "待查證",
  barcode: "無條碼",
  packaging: "",
  contents: "",
  tracks: "",
  identifyBy: "",
  status: "已確認",
  owners: 0,
  wanted: 0,
  color: "#22334D",
  ...v,
});

export const seriesList: Series[] = [
  {
    artistSlug: "mountain-radio",
    no: 1,
    title: "夜行採集",
    name: "2018《夜行採集》專輯發行",
    seriesType: "專輯發行",
    credits: ["mountain-radio"],
    year: "2018",
    body: [
      "山線電台首張正式專輯，共十首，錄於台中舊倉庫改建的工作室。2018 年由自家廠牌在台灣首度發行，首批為紙套裝，發片場另外賣限量卡帶。2020 年日本廠牌 Kanata Records 取得代理後重新壓片，加上側標並更換背面的公司資訊，目錄號也跟著換掉。2021 年出黑膠，2023 年台灣再版 CD 改用塑膠盒，加收一首現場版。",
      "專輯獲 2019 年金音創作獎最佳專輯入圍。",
    ],
    guests: [],
    compilation: [],
    items: [
      {
        id: "cd",
        kind: "CD",
        versions: [
          V({
            id: "v1", edition: "首批紙套版", year: "2018", label: "山線自製", catalog: "ML-018-A",
            barcode: "4712345678901", packaging: "紙套", contents: "CD、歌詞折頁", tracks: "10 首",
            identifyBy: "紙套不是塑膠盒。背面左下印「山線自製」，目錄號在紙套背面右下角，字體較小。",
            marks: [
              { label: "包裝", text: "紙套，沒有塑膠盒", photo: "紙套正面" },
              { label: "背面印刷", text: "左下「山線自製」，右下目錄號 ML-018-A，字級比日版小", photo: "紙套背面右下" },
              { label: "碟面", text: "內圈刻 ML-018-A 與壓片廠代號 TWP", photo: "碟面內圈" },
            ],
            owners: 17, wanted: 7, color: "#22334D",
          }),
          V({
            id: "v2", edition: "日版附側標", year: "2020", region: "日本", label: "Kanata Records",
            catalog: "MLJP-020", barcode: "4988000123456", packaging: "塑膠盒＋側標",
            contents: "CD、歌詞折頁、日文解說、側標", tracks: "10 首",
            identifyBy: "塑膠盒加日文側標。背面公司資訊是 Kanata Records，附日文解說書。側標不見時看背面公司資訊與目錄號。",
            marks: [
              { label: "側標", text: "直式日文側標，背面印定價與 MLJP-020", photo: "側標正反面" },
              { label: "條碼", text: "4988 開頭，印在盒背右下，不在側標上", photo: "盒背條碼" },
              { label: "解說書", text: "8 頁日文解說，最後一頁有譯者署名" },
              { label: "碟面", text: "內圈刻 MLJP-020 與日本壓片廠代號", photo: "碟面內圈" },
            ],
            fakes: [
              {
                name: "仿日版（無解說書）",
                seen: "2025 年起在海外拍賣與二手社團出現",
                rows: [
                  { label: "側標", genuine: "紙質霧面，背面印定價", fake: "紙質亮面，背面空白" },
                  { label: "條碼", genuine: "盒背右下，4988 開頭", fake: "印在側標上，號碼與台版相同" },
                  { label: "解說書", genuine: "8 頁日文解說", fake: "沒有" },
                  { label: "碟面內圈", genuine: "刻 MLJP-020", fake: "沒有刻字，只有印刷" },
                ],
              },
            ],
            owners: 6, wanted: 11, color: "#4A2C3D",
          }),
          V({
            id: "v3", edition: "2023 再版", year: "2023", label: "山線自製", catalog: "ML-018-R",
            barcode: "4712345678918", packaging: "塑膠盒", contents: "CD、歌詞本", tracks: "11 首",
            identifyBy: "塑膠盒，背面印「2023 再版」。第 11 首是〈夜行〉現場版。",
            owners: 9, wanted: 2, color: "#2F3E5C",
          }),
        ],
      },
      {
        id: "cassette",
        kind: "卡帶",
        versions: [
          V({
            id: "v1", edition: "發片場限定", year: "2018", label: "山線自製", catalog: "ML-018-C",
            packaging: "透明盒＋J 卡", contents: "卡帶、J 卡", tracks: "10 首",
            identifyBy: "J 卡背面蓋發片場日期章 2018.11.03。",
            marks: [{ label: "日期章", text: "J 卡背面右下，藍色 2018.11.03", photo: "J 卡背面" }],
            status: "待確認", owners: 4, wanted: 12, color: "#3E3F4A",
          }),
        ],
      },
      {
        id: "vinyl",
        kind: "黑膠",
        versions: [
          V({
            id: "v1", edition: "2021 黑膠", year: "2021", label: "山線自製", catalog: "ML-018-LP",
            barcode: "4712345678925", packaging: "硬紙封套", contents: "黑膠、內頁", tracks: "10 首",
            identifyBy: "黑色 180g，內頁有 CD 版沒有的錄音照片。",
            owners: 5, wanted: 8, color: "#26262B",
          }),
        ],
      },
    ],
    lastEdit: { by: "阿澤", date: "2026-09-24" },
  },
  {
    artistSlug: "mountain-radio",
    no: 2,
    title: "山線",
    name: "2016《山線》自製卡帶",
    seriesType: "自製發行",
    credits: ["mountain-radio"],
    year: "2016",
    body: ["正式出道前在台中獨立書店寄賣的自製卡帶，附手繪歌詞，數量未公開。"],
    guests: [],
    compilation: [],
    items: [
      {
        id: "cassette",
        kind: "卡帶",
        versions: [
          V({
            id: "v1", edition: "書店寄賣版", year: "2016", label: "山線自製",
            packaging: "透明盒＋手繪歌詞", contents: "卡帶、手繪歌詞一張", tracks: "6 首",
            identifyBy: "盒內歌詞是手繪影印，右下角有書店印章。",
            marks: [{ label: "書店印章", text: "歌詞右下角紅色圓章「綠川書房」", photo: "歌詞右下" }],
            status: "待確認", owners: 3, wanted: 14, color: "#3E3F4A",
          }),
        ],
      },
    ],
    lastEdit: { by: "小孟", date: "2026-09-21" },
  },
  {
    artistSlug: "tide-highway",
    no: 1,
    title: "島嶼低鳴",
    name: "2022《島嶼低鳴》專輯發行",
    seriesType: "專輯發行",
    credits: ["tide-highway"],
    year: "2022",
    body: ["潮汐公路第二張專輯。首批黑膠為透明海藍色，內附小海報；一般版為黑色膠片，不附海報。第 6 首〈北上〉由山線電台主唱合唱。"],
    guests: [{ artistSlug: "mountain-radio", role: "合唱", track: "〈北上〉" }],
    compilation: [],
    items: [
      {
        id: "vinyl",
        kind: "黑膠",
        versions: [
          V({
            id: "v1", edition: "透明海藍膠", year: "2022", label: "潮汐公路",
            catalog: "TS-022-LP", barcode: "4712999000123", packaging: "硬紙封套",
            contents: "黑膠、內袋、小海報", tracks: "9 首",
            identifyBy: "膠片透光呈海藍色。內袋右下有「1st press」字樣。",
            marks: [
              { label: "膠片", text: "對光看呈海藍色，邊緣透光均勻", photo: "膠片透光" },
              { label: "內袋", text: "右下角印「1st press」", photo: "內袋右下" },
              { label: "小海報", text: "A3 對折兩次，背面有錄音室平面圖" },
            ],
            fakes: [
              {
                name: "仿首批彩膠",
                seen: "2024 年起在海外購物平台出現，標價比行情低一半",
                rows: [
                  { label: "膠片顏色", genuine: "海藍，透光均勻", fake: "偏綠，中心混濁" },
                  { label: "內袋", genuine: "右下印「1st press」", fake: "白色素面內袋" },
                  { label: "小海報", genuine: "A3 對折兩次", fake: "A4 單張，沒有平面圖" },
                ],
              },
            ],
            owners: 11, wanted: 20, color: "#1E4B57",
          }),
          V({
            id: "v2", edition: "黑膠一般版", year: "2022", label: "潮汐公路",
            catalog: "TS-022-LP2", barcode: "4712999000130", packaging: "硬紙封套",
            contents: "黑膠、內袋", tracks: "9 首",
            identifyBy: "黑色膠片，內袋沒有「1st press」字樣。",
            owners: 4, wanted: 3, color: "#2A3B40",
          }),
        ],
      },
    ],
    lastEdit: { by: "安琪", date: "2026-09-18" },
  },
  {
    artistSlug: "tide-highway",
    no: 2,
    title: "海線對話",
    name: "2024《海線對話》EP 發行",
    seriesType: "EP 發行",
    credits: ["tide-highway", "mountain-radio"],
    year: "2024",
    body: ["潮汐公路與山線電台共同署名的四曲 EP，由潮汐公路的自家廠牌發行。兩團各寫兩首，互換主唱。"],
    guests: [],
    compilation: [],
    items: [
      {
        id: "cd",
        kind: "CD",
        versions: [
          V({
            id: "v1", edition: "首批 CD", year: "2024", label: "潮汐公路", catalog: "TS-024-EP",
            barcode: "4712999000215", packaging: "紙盒", contents: "CD、雙面海報", tracks: "4 首",
            identifyBy: "紙盒側邊同時印兩團團名，海報背面是錄音室合照。",
            owners: 8, wanted: 5, color: "#2B4A3A",
          }),
        ],
      },
    ],
    lastEdit: { by: "小孟", date: "2026-09-22" },
  },
  {
    artistSlug: "tide-highway",
    no: 3,
    title: "海潮",
    name: "2024《海潮》巡迴演唱會",
    seriesType: "巡迴演唱會",
    credits: ["tide-highway"],
    year: "2024",
    body: ["2024 年秋天台北、台中、台南三場。會場只賣周邊，沒有發行唱片；台南場的毛巾換成白色，只賣那一場。"],
    guests: [],
    compilation: [],
    items: [
      {
        id: "towel",
        kind: "毛巾",
        versions: [
          V({
            id: "v1", edition: "巡演一般版", year: "2024", label: "潮汐公路",
            packaging: "透明夾鏈袋", contents: "毛巾 110×20 cm", tracks: "—",
            identifyBy: "深藍底白字，右下角繡「2024 TOUR」。",
            marks: [
              { label: "繡字", text: "右下角「2024 TOUR」是刺繡不是印刷", photo: "毛巾右下" },
              { label: "吊牌", text: "紙吊牌背面有三個場次日期", photo: "吊牌背面" },
            ],
            owners: 21, wanted: 6, color: "#23405A",
          }),
          V({
            id: "v2", edition: "台南場限定", year: "2024", label: "潮汐公路",
            packaging: "透明夾鏈袋", contents: "毛巾 110×20 cm", tracks: "—",
            identifyBy: "白底深藍字，右下角繡「TAINAN」。",
            marks: [{ label: "繡字", text: "右下角「TAINAN」，一般版沒有", photo: "毛巾右下" }],
            owners: 7, wanted: 15, color: "#D9D9D9",
          }),
        ],
      },
      {
        id: "tee",
        kind: "T 恤",
        versions: [
          V({
            id: "v1", edition: "巡演 T 恤", year: "2024", label: "潮汐公路",
            packaging: "摺疊裝袋", contents: "T 恤，S～XL", tracks: "—",
            identifyBy: "黑色，背面印三個場次與日期。",
            owners: 12, wanted: 3, color: "#1B1B1B",
          }),
        ],
      },
      {
        id: "program",
        kind: "場刊",
        versions: [
          V({
            id: "v1", edition: "巡演場刊", year: "2024", label: "潮汐公路",
            packaging: "騎馬釘", contents: "場刊 40 頁", tracks: "—",
            identifyBy: "封面燙銀，封底印三場日期。",
            owners: 9, wanted: 4, color: "#4B3B2A",
          }),
        ],
      },
    ],
    lastEdit: { by: "安琪", date: "2026-09-25" },
  },
  {
    artistSlug: "empty-room",
    no: 1,
    title: "留聲便條",
    name: "2017《留聲便條》巡演",
    seriesType: "巡迴演出",
    credits: ["empty-room"],
    year: "2017",
    body: ["巡演限定卡帶，只在現場販售。外盒只有場次貼紙與手寫編號，不同場次的貼紙是否由官方統一製作仍待確認。錄音與混音由山線電台負責。"],
    guests: [{ artistSlug: "mountain-radio", role: "錄音、混音", track: "卡帶全部曲目" }],
    compilation: [],
    items: [
      {
        id: "cassette",
        kind: "卡帶",
        versions: [
          V({
            id: "v1", edition: "巡演限定版", year: "2017", label: "空房間",
            packaging: "透明盒＋場次貼紙", contents: "卡帶、手寫編號", tracks: "8 首",
            identifyBy: "外盒貼場次貼紙，卡帶 A 面右上有手寫編號。",
            status: "待確認", owners: 3, wanted: 9, color: "#3E3F4A",
          }),
        ],
      },
    ],
    lastEdit: { by: "阿澤", date: "2026-09-12" },
  },
  {
    artistSlug: "before-rain-stops",
    no: 1,
    title: "南方現場",
    name: "2021《南方現場》影像發行",
    seriesType: "影像發行",
    credits: ["before-rain-stops"],
    year: "2021",
    body: ["收錄 2020 年高雄場全場。首批盒裝附 32 頁場刊，再版改用標準藍光盒並移除場刊。"],
    guests: [],
    compilation: [],
    items: [
      {
        id: "bluray",
        kind: "藍光／DVD",
        versions: [
          V({
            id: "v1", edition: "首批盒裝版", year: "2021", label: "雨停以前",
            catalog: "RB-021-BD", barcode: "4712888000456", packaging: "紙盒",
            contents: "Blu-ray、32 頁場刊", tracks: "18 首",
            identifyBy: "外盒是紙盒不是標準藍光盒，內含 32 頁場刊。",
            owners: 8, wanted: 5, color: "#1F2A44",
          }),
          V({
            id: "v2", edition: "再版標準盒", year: "2022", label: "雨停以前",
            catalog: "RB-021-BD2", barcode: "4712888000463", packaging: "標準藍光盒",
            contents: "Blu-ray", tracks: "18 首",
            identifyBy: "標準藍光盒，沒有場刊，背面右下印「2nd」。",
            owners: 5, wanted: 1, color: "#33415C",
          }),
        ],
      },
    ],
    lastEdit: { by: "阿哲", date: "2026-09-10" },
  },
  {
    artistSlug: "faint-signal",
    no: 1,
    title: "凌晨四點",
    name: "2019《凌晨四點》EP 宣傳",
    seriesType: "EP 宣傳",
    credits: ["faint-signal"],
    year: "2019",
    body: ["四曲 EP。市面流通的多為電台宣傳片，未公開發售。"],
    guests: [],
    compilation: [],
    items: [
      {
        id: "cd",
        kind: "CD",
        versions: [
          V({
            id: "v1", edition: "電台宣傳片", year: "2019", label: "微光訊號", catalog: "PROMO-04",
            packaging: "紙袋", contents: "CD-R", tracks: "4 首",
            identifyBy: "碟面印「PROMO 非賣品」，紙袋無印刷。",
            marks: [
              { label: "碟面", text: "印「PROMO 非賣品」，燒錄面偏藍", photo: "碟面" },
              { label: "紙袋", text: "牛皮紙袋，沒有印刷" },
            ],
            status: "待確認", owners: 2, wanted: 16, color: "#5A4634",
          }),
        ],
      },
    ],
    lastEdit: { by: "rin", date: "2026-09-08" },
  },
  {
    artistSlug: "harbor-fest",
    no: 1,
    title: "海港音樂祭 2019",
    name: "2019 海港音樂祭",
    seriesType: "音樂祭",
    credits: ["harbor-fest"],
    year: "2019",
    body: [
      "2019 年 8 月在高雄駁二舉辦兩天。會場販售現場精選 CD，三組藝人各收一首；場刊 48 頁，第 14 頁是山線電台專訪，第 30 頁起是全部演出者介紹。",
    ],
    guests: [{ artistSlug: "mountain-radio", role: "專訪", track: "場刊第 14 頁" }],
    compilation: [
      { artistSlug: "mountain-radio", track: "〈山線〉現場版" },
      { artistSlug: "tide-highway", track: "〈退潮〉" },
      { artistSlug: "empty-room", track: "〈便條〉" },
    ],
    items: [
      {
        id: "cd",
        kind: "CD",
        versions: [
          V({
            id: "v1", edition: "現場精選 會場販售版", year: "2019", label: "海港音樂祭", catalog: "HF-2019",
            barcode: "4712777000019", packaging: "紙套＋側標", contents: "CD、側標", tracks: "12 首",
            identifyBy: "側標印「會場限定」，紙套背面有三組藝人名單。",
            owners: 5, wanted: 4, color: "#1E3A5F",
          }),
        ],
      },
      {
        id: "program",
        kind: "場刊",
        versions: [
          V({
            id: "v1", edition: "首刷", year: "2019", label: "海港音樂祭",
            packaging: "騎馬釘", contents: "場刊 48 頁", tracks: "—",
            identifyBy: "封底右下印「2019.08 首刷」。",
            owners: 4, wanted: 6, color: "#4B3B2A",
          }),
        ],
      },
    ],
    lastEdit: { by: "安琪", date: "2026-09-15" },
  },
];

export const shares: Share[] = [
  {
    n: 1, author: "xiaomeng", time: "今天", order: 120,
    what: "夜行採集 台灣首批紙套 CD，跟日版擺一起", kind: "CD",
    story: "台灣首批是紙套，日本版多了側標，背面的公司資訊也不一樣。一直以為只是包裝差別，實際擺在一起比才發現目錄號根本不同。",
    about: ["山線電台"], tags: ["首刷"], likes: 12, color: "#22334D",
    image: "/images/fictional-music-collection.jpg",
    link: { series: "mountain-radio/1", item: "cd", version: "v1" },
    sale: { state: "sale", price: 1200 },
    refPhoto: true,
  },
  {
    n: 2, author: "aze", time: "昨天", order: 110,
    what: "空房間 2017 巡演限定卡帶，外盒有場次貼紙", kind: "卡帶",
    story: "外盒只有場次貼紙和一組手寫編號 037。",
    about: ["空房間"], tags: ["卡帶", "演唱會戰利品"], likes: 4, color: "#3E3F4A",
    link: { series: "empty-room/1", item: "cassette", version: "v1" },
  },
  {
    n: 3, author: "angie", time: "3 天前", order: 100,
    what: "2019 海港音樂祭場刊，第 14 頁有山線電台的專訪", kind: "場刊",
    story: "",
    about: ["山線電台", "海港音樂祭"], tags: ["場刊"], likes: 30, color: "#4B3B2A",
    link: { series: "harbor-fest/1", item: "program", version: "v1" },
    sale: { state: "offer" },
  },
  {
    n: 4, author: "angie", time: "4 天前", order: 95,
    what: "島嶼低鳴 透明海藍膠，缺了內附小海報", kind: "黑膠",
    story: "想先確認首批是不是每張都有海報，再決定要換一張完整的，還是單收海報就好。",
    about: ["潮汐公路"], tags: ["黑膠"], likes: 9, color: "#1E4B57",
    link: { series: "tide-highway/1", item: "vinyl", version: "v1" },
  },
  {
    n: 5, author: "azhe", time: "上週", order: 80,
    what: "南方現場 藍光盒裝，簽名在場刊內頁", kind: "藍光",
    story: "高雄場結束後排隊簽的，三個人都簽在第 3 頁。",
    about: ["雨停以前"], tags: ["簽名"], likes: 26, color: "#1F2A44",
    link: { series: "before-rain-stops/1", item: "bluray", version: "v1" },
  },
  {
    n: 6, author: "rin", time: "上週", order: 78,
    what: "凌晨四點 電台宣傳片 PROMO-04", kind: "CD-R",
    story: "",
    about: ["微光訊號"], tags: ["宣傳片"], likes: 2, color: "#5A4634",
    link: { series: "faint-signal/1", item: "cd", version: "v1" },
    sale: { state: "sale", price: 2400 },
  },
  {
    n: 7, author: "rin", time: "上週", order: 76,
    what: "日版側標完整，解說書有譯者簽名", kind: "CD",
    story: "",
    about: ["Mountain Radio"], tags: ["日版", "簽名"], likes: 5, color: "#4A2C3D",
    link: { series: "mountain-radio/1", item: "cd", version: "v2" },
    sale: { state: "sold", price: 900, soldPrice: 900, soldTo: "aze", soldAt: "9 月 20 日" },
  },
  {
    n: 8, author: "xiaomeng", time: "上個月", order: 60,
    what: "2016 台中書店寄賣的自製卡帶，附手繪歌詞", kind: "卡帶",
    story: "在書店收銀台旁邊的紙箱裡找到，老闆說只進過一箱。",
    about: ["山線電台"], tags: ["卡帶", "自製"], likes: 19, color: "#3E3F4A",
    link: { series: "mountain-radio/2", item: "cassette", version: "v1" },
    sale: { state: "offer" },
  },
  {
    n: 9, author: "azhe", time: "上個月", order: 58,
    what: "海港音樂祭 2019 演出海報，三人簽名", kind: "海報",
    story: "",
    about: ["山線電台", "海港音樂祭"], tags: ["簽名", "海報"], likes: 8, color: "#5C3A3A",
    sale: { state: "sale", price: 1800 },
  },
  {
    n: 10, author: "xiaomeng", time: "上個月", order: 55,
    what: "海線對話 EP，兩團合體的那張", kind: "CD",
    story: "紙盒側邊兩個團名並排，海報背面是錄音室合照。",
    about: ["潮汐公路", "山線電台"], tags: [], likes: 14, color: "#2B4A3A",
    link: { series: "tide-highway/2", item: "cd", version: "v1" },
  },
  {
    n: 11, author: "aze", time: "兩個月前", order: 40,
    what: "海港音樂祭現場精選 CD，側標還在", kind: "CD",
    story: "",
    about: ["海港音樂祭"], tags: ["合輯"], likes: 6, color: "#1E3A5F",
    link: { series: "harbor-fest/1", item: "cd", version: "v1" },
    sale: { state: "sale", price: 450 },
  },
  {
    n: 12, author: "azhe", time: "兩個月前", order: 38,
    what: "首批紙套背面的「山線自製」印刷偏移", kind: "CD",
    story: "同一批買了兩張，只有一張偏移，應該是個別印刷誤差，不算另一個版本。",
    about: ["山線電台"], tags: ["首刷", "印刷差異"], likes: 3, color: "#22334D",
    link: { series: "mountain-radio/1", item: "cd", version: "v1" },
    sale: { state: "sold", soldPrice: 600, soldTo: "xiaomeng", soldAt: "9 月 18 日" },
    refPhoto: true,
  },
  {
    n: 90, author: "angie", time: "2 天前", order: 105,
    what: "林夏 2024 花蓮場演出毛巾", kind: "毛巾",
    story: "只在花蓮場賣，白底藍字。",
    about: ["林夏"], tags: ["周邊"], likes: 7, color: "",
  },
  {
    n: 91, author: "rin", time: "5 天前", order: 90,
    what: "新井健次 台北場限定毛巾，還有吊牌", kind: "毛巾",
    story: "",
    about: ["新井健次"], tags: ["周邊", "未拆"], likes: 11, color: "",
    sale: { state: "sale", price: 650 },
  },
  {
    n: 92, author: "aze", time: "今天", order: 115,
    what: "海潮巡演 台南場白色毛巾，只賣那一場", kind: "毛巾",
    story: "台南場排了一小時才買到，吊牌背面三個場次都印了，但只有台南場賣白色。",
    about: ["潮汐公路"], tags: ["演唱會戰利品"], likes: 16, color: "",
    link: { series: "tide-highway/3", item: "towel", version: "v2" },
    refPhoto: true,
  },
  {
    n: 93, author: "angie", time: "昨天", order: 108,
    what: "海潮巡演 T 恤，背面三個場次", kind: "T 恤",
    story: "",
    about: ["潮汐公路"], tags: ["周邊"], likes: 5, color: "",
    link: { series: "tide-highway/3", item: "tee", version: "v1" },
    sale: { state: "offer" },
  },
  {
    n: 94, author: "azhe", time: "3 天前", order: 98,
    what: "海潮巡演場刊，封面燙銀", kind: "場刊",
    story: "",
    about: ["潮汐公路"], tags: ["場刊"], likes: 3, color: "",
    link: { series: "tide-highway/3", item: "program" },
  },
  {
    n: 95, author: "rin", time: "4 天前", order: 94,
    what: "夜行採集 發片場限定卡帶，日期章清楚", kind: "卡帶",
    story: "",
    about: ["山線電台"], tags: ["卡帶", "首刷"], likes: 10, color: "",
    link: { series: "mountain-radio/1", item: "cassette", version: "v1" },
    sale: { state: "sale", price: 900 },
  },
  {
    n: 96, author: "angie", time: "上週", order: 79,
    what: "夜行採集 2021 黑膠，內頁照片那版", kind: "黑膠",
    story: "",
    about: ["山線電台"], tags: ["黑膠"], likes: 8, color: "",
    link: { series: "mountain-radio/1", item: "vinyl", version: "v1" },
  },
];
/*
 * 分頁示範用的補充資料：每頁 24 則，12 則只有一頁，這裡補到三頁。
 * 內容一樣是虛構，每位藝人八則，出售狀態輪流分配。
 */
type Seed = [what: string, kind: string, tags: string[], link?: string];
const MORE: Record<string, { about: string; items: Seed[] }> = {
  "mountain-radio": {
    about: "山線電台",
    items: [
      ["夜行採集 2023 再版，腰帶換成白色", "CD", ["再版"], "mountain-radio/1#cd-v3"],
      ["台中場巡演手環，布料那款", "手環", ["演唱會戰利品"]],
      ["山線 書店寄賣卡帶的手寫編號 012", "卡帶", ["卡帶", "自製"], "mountain-radio/2#cassette-v1"],
      ["2018 發片場的貼紙三張組", "貼紙", ["周邊"]],
      ["夜行採集 日版解說書單本", "解說書", ["日版"], "mountain-radio/1#cd-v2"],
      ["主唱手寫的歌詞明信片，發片場抽的", "明信片", ["簽名"]],
      ["第一次售票場的紙本票根", "票根", ["票根"]],
      ["夜行採集 首批紙套，塑膠套沒拆", "CD", ["首刷", "未拆"], "mountain-radio/1#cd-v1"],
    ],
  },
  "tide-highway": {
    about: "潮汐公路",
    items: [
      ["島嶼低鳴 黑膠一般版，側邊有磨痕", "黑膠", ["黑膠"], "tide-highway/1#vinyl-v2"],
      ["台南工作室開放日送的試聽卡帶", "卡帶", ["宣傳片"]],
      ["海線對話 EP 首批，紙盒四角完整", "CD", ["首刷"], "tide-highway/2#cd-v1"],
      ["島嶼低鳴 內附小海報，單張", "海報", ["海報"]],
      ["2023 巡演 T 恤，黑色 M 號", "T 恤", ["周邊"]],
      ["潮汐公路第一張自製 CD-R", "CD-R", ["自製"]],
      ["島嶼低鳴 透明海藍膠，海報還在", "黑膠", ["黑膠", "首刷"], "tide-highway/1#vinyl-v1"],
      ["鼓手簽在鼓棒上的那支", "鼓棒", ["簽名"]],
    ],
  },
  "empty-room": {
    about: "空房間",
    items: [
      ["留聲便條 巡演限定卡帶，編號 102", "卡帶", ["卡帶"], "empty-room/1#cassette-v1"],
      ["2017 巡演的場次海報，台北場", "海報", ["海報"]],
      ["空房間的手作歌詞本，騎馬釘", "歌詞本", ["自製"]],
      ["留聲便條 封面原畫的縮小版印刷", "版畫", ["周邊"]],
      ["小型演出的入場蓋章卡", "票根", ["票根"]],
      ["留聲便條 卡帶，外盒貼紙缺角", "卡帶", ["卡帶"], "empty-room/1#cassette-v1"],
      ["2019 聖誕場限定毛巾", "毛巾", ["周邊"]],
      ["錄音室外流的混音參考 CD-R", "CD-R", ["宣傳片"]],
    ],
  },
  "before-rain-stops": {
    about: "雨停以前",
    items: [
      ["南方現場 再版標準盒，封膜還在", "藍光", ["再版", "未拆"], "before-rain-stops/1#bluray-v2"],
      ["高雄場的簽名海報，三人全簽", "海報", ["簽名", "海報"]],
      ["南方現場 首批盒裝，場刊完整", "藍光", ["首刷"], "before-rain-stops/1#bluray-v1"],
      ["雨停以前 2020 巡演毛巾", "毛巾", ["周邊"]],
      ["台南場的紙本票根，連號兩張", "票根", ["票根"]],
      ["南方現場 首批盒裝的外紙盒單獨", "外盒", ["首刷"]],
      ["主唱簽名的撥片", "撥片", ["簽名"]],
      ["第一張 EP 的宣傳明信片", "明信片", ["宣傳片"]],
    ],
  },
  "faint-signal": {
    about: "微光訊號",
    items: [
      ["凌晨四點 電台宣傳片，封套有電台章", "CD-R", ["宣傳片"], "faint-signal/1#cd-v1"],
      ["微光訊號 2019 小巡演的貼紙", "貼紙", ["周邊"]],
      ["凌晨四點 試聽會的邀請卡", "邀請卡", ["宣傳片"]],
      ["微光訊號手寫歌單，台北場", "歌單", ["簽名"]],
      ["凌晨四點 宣傳片，無電台章版", "CD-R", ["宣傳片"], "faint-signal/1#cd-v1"],
      ["2021 線上演出的紀念徽章", "徽章", ["周邊"]],
      ["第一場售票演出的票根", "票根", ["票根"]],
      ["錄音筆記影印本，樂手自己釘的", "筆記", ["自製"]],
    ],
  },
  "harbor-fest": {
    about: "海港音樂祭",
    items: [
      ["海港音樂祭 2019 現場精選，側標完整", "CD", ["合輯"], "harbor-fest/1#cd-v1"],
      ["2019 場刊，第 14 頁有摺痕", "場刊", ["場刊"], "harbor-fest/1#program-v1"],
      ["2018 海港音樂祭工作人員證", "工作證", ["周邊"]],
      ["2019 兩日票，手環還沒剪", "手環", ["票根", "未拆"]],
      ["2017 海港音樂祭場刊，第一屆", "場刊", ["場刊"]],
      ["2019 志工 T 恤，白色 L 號", "T 恤", ["周邊"]],
      ["海港音樂祭現場精選，會場販售版", "CD", ["合輯"], "harbor-fest/1#cd-v1"],
      ["2019 攤位地圖，折三折那張", "地圖", ["周邊"]],
    ],
  },
};

const AUTHORS = ["aze", "angie", "azhe", "rin", "xiaomeng"];
const TIMES = ["兩個月前", "三個月前", "四個月前", "半年前"];
const SALES: (Sale | undefined)[] = [
  undefined, { state: "sale", price: 350 }, undefined, { state: "offer" }, undefined,
  { state: "sale", price: 800 }, { state: "sold", price: 500, soldPrice: 500, soldTo: "angie", soldAt: "8 月 2 日" }, undefined,
];

const extraShares: Share[] = Object.values(MORE).flatMap(({ about, items }, ai) =>
  items.map(([what, kind, tags, link], i) => {
    const idx = ai * 8 + i;
    const [series, anchor] = link ? link.split("#") : [];
    const [item, version] = anchor ? anchor.split("-") : [];
    return {
      n: 13 + idx,
      author: AUTHORS[(idx * 3 + ai) % AUTHORS.length],
      time: TIMES[Math.floor(idx / 12)],
      order: 36 - idx * 0.5,
      what,
      kind,
      story: "",
      about: [about],
      tags,
      likes: (idx * 7) % 23,
      color: "",
      link: series ? { series, item, version } : undefined,
      sale: SALES[(i + ai) % SALES.length],
    };
  }),
);

shares.push(...extraShares.sort((a, b) => b.order - a.order));

export const users: User[] = [
  {
    handle: "xiaomeng", name: "小孟", initials: "孟",
    bio: "台中，收獨立樂團的實體，卡帶為主。",
    owned: ["mountain-radio/1#cd-v1", "mountain-radio/2#cassette-v1", "empty-room/1#cassette-v1", "tide-highway/2#cd-v1"],
    wanted: ["mountain-radio/1#cd-v2", "tide-highway/1#vinyl-v1"],
    liked: [3, 5],
    verified: true,
    follows: ["mountain-radio", "tide-highway"],
  },
  {
    handle: "aze", name: "阿澤", initials: "澤",
    bio: "卡帶與現場限定，版本資料常在補。",
    owned: ["empty-room/1#cassette-v1", "harbor-fest/1#cd-v1", "mountain-radio/1#cd-v1"],
    wanted: ["mountain-radio/2#cassette-v1"], liked: [], verified: true, follows: [],
  },
  {
    handle: "angie", name: "安琪", initials: "安",
    bio: "黑膠與紙本，場刊收了四十幾本。",
    owned: ["tide-highway/1#vinyl-v1", "harbor-fest/1#program-v1"],
    wanted: ["before-rain-stops/1#bluray-v1"], liked: [], verified: true, follows: [],
  },
  {
    handle: "azhe", name: "阿哲", initials: "哲",
    bio: "南部現場，簽名控。",
    owned: ["before-rain-stops/1#bluray-v1", "mountain-radio/1#cd-v1"],
    wanted: [], liked: [], verified: false, follows: [],
  },
  {
    handle: "rin", name: "rin", initials: "R",
    bio: "日版與宣傳片。",
    owned: ["mountain-radio/1#cd-v2", "faint-signal/1#cd-v1"],
    wanted: ["faint-signal/1#cd-v1"], liked: [], verified: true, follows: [],
  },
  {
    handle: "kai", name: "阿凱", initials: "凱",
    bio: "剛加入，還沒完成認證。",
    owned: [], wanted: [], liked: [], verified: false, follows: [],
  },
];

/* ---------- 出價與私訊（示範） ----------
 * 私訊只能從一則炫收藏發起：一位買家對一則收藏只有一條對話，id＝`{則}-{買家}`。
 * 出價與「我要買」是對話裡的結構化訊息，單則頁的公開出價列表從這裡整理出來，
 * 資料只有一份。
 */

export type OfferKind = "offer" | "buy";
/** open 等賣家回；accepted 賣家接受、還沒成交；rejected 賣家拒絕；withdrawn 買家自己撤回；sold 成交的那一筆 */
export type OfferStatus = "open" | "accepted" | "rejected" | "withdrawn" | "sold";

export type Message = {
  id: string;
  /** 使用者帳號；"system" 是狀態變化的灰字 */
  from: string;
  time: string;
  text?: string;
  offer?: { kind: OfferKind; price: number; status: OfferStatus };
};

export type Thread = { id: string; n: number; buyer: string; messages: Message[] };

const T = (n: number, buyer: string, msgs: Omit<Message, "id">[]): Thread => ({
  id: `${n}-${buyer}`,
  n,
  buyer,
  messages: msgs.map((m, i) => ({ ...m, id: `${n}-${buyer}-${i}` })),
});

export const threads: Thread[] = [
  // 小孟是賣家
  T(1, "aze", [
    { from: "aze", time: "昨天 18:02", text: "紙套邊角有沒有壓痕？" },
    { from: "xiaomeng", time: "昨天 19:30", text: "右下角有一點點，照片第一張看得到。" },
    { from: "aze", time: "10 分鐘前", offer: { kind: "buy", price: 1200, status: "open" } },
    { from: "aze", time: "10 分鐘前", text: "週末台中可以面交嗎？" },
  ]),
  T(1, "rin", [{ from: "rin", time: "上週", text: "日版那張也會賣嗎？" }]),
  T(8, "azhe", [{ from: "azhe", time: "2 天前", offer: { kind: "offer", price: 500, status: "open" } }]),
  T(8, "angie", [
    { from: "angie", time: "昨天", offer: { kind: "offer", price: 800, status: "open" } },
    { from: "angie", time: "昨天", text: "手繪歌詞那張也在盒子裡嗎？" },
  ]),
  T(8, "rin", [
    { from: "rin", time: "上週", offer: { kind: "offer", price: 300, status: "rejected" } },
    { from: "system", time: "上週", text: "賣家拒絕了 NT$ 300" },
  ]),
  // 小孟是買家
  T(3, "xiaomeng", [
    { from: "xiaomeng", time: "昨天", offer: { kind: "offer", price: 600, status: "open" } },
    { from: "xiaomeng", time: "昨天", text: "第 14 頁的專訪那頁有沒有摺痕？" },
    { from: "angie", time: "今天", text: "沒有，全新沒翻過。" },
  ]),
  T(3, "aze", [{ from: "aze", time: "今天", offer: { kind: "offer", price: 700, status: "open" } }]),
  T(9, "xiaomeng", [
    { from: "xiaomeng", time: "3 天前", text: "簽名是現場簽的嗎？" },
    { from: "azhe", time: "3 天前", text: "對，2019 那場結束後排隊簽的。" },
  ]),
  T(6, "angie", [{ from: "angie", time: "上週", offer: { kind: "buy", price: 2400, status: "open" } }]),
  T(7, "aze", [
    { from: "aze", time: "9 月 19 日", offer: { kind: "buy", price: 900, status: "sold" } },
    { from: "system", time: "9 月 20 日", text: "已成交 NT$ 900" },
  ]),
  T(12, "xiaomeng", [
    { from: "xiaomeng", time: "9 月 16 日", offer: { kind: "offer", price: 600, status: "sold" } },
    { from: "system", time: "9 月 17 日", text: "賣家接受了 NT$ 600" },
    { from: "system", time: "9 月 18 日", text: "已成交 NT$ 600" },
  ]),
];

/** 示範的未讀：小孟的收藏有新的「我要買」 */
export const UNREAD_SEED = ["1-aze"];

export const priceText = (p: number) => `NT$ ${p.toLocaleString("en-US")}`;

/* ---------- 查詢 ---------- */

export const getArtist = (slug: string) => artists.find((a) => a.slug === slug);
export const getUser = (handle: string) => users.find((u) => u.handle === handle);
export const getShare = (n: number) => shares.find((s) => s.n === n);

export const seriesKey = (w: Series) => `${w.artistSlug}/${w.no}`;
export const getSeriesByKey = (key: string) => seriesList.find((w) => seriesKey(w) === key);
export const getSeries = (artistSlug: string, no: number) =>
  seriesList.find((w) => w.artistSlug === artistSlug && w.no === no);
export const getItem = (w: Series, itemId?: string) => (itemId ? w.items.find((i) => i.id === itemId) : undefined);
export const versionCount = (w: Series) => w.items.reduce((n, i) => n + i.versions.length, 0);

export const artistHref = (slug: string) => `/artist/${slug}`;
export const seriesHref = (w: Series) => `/artist/${w.artistSlug}/${w.no}`;
/** 錨點：品項 #cd、版本 #cd-v1 */
export const itemAnchor = (item: Item) => item.id;
export const versionAnchor = (item: Item, v: Version) => `${item.id}-${v.id}`;
export const itemHref = (w: Series, item: Item) => `${seriesHref(w)}#${itemAnchor(item)}`;
export const versionHref = (w: Series, item: Item, v: Version) => `${seriesHref(w)}#${versionAnchor(item, v)}`;
export const tagHref = (tag: string) => `/tag/${encodeURIComponent(tag)}`;
export const shareHref = (n: number) => `/share/${n}`;
export const userHref = (handle: string) => `/u/${handle}`;

/** 版本鍵 `{發行方}/{流水號}#cd-v1`，我有／想要、檢舉用 */
export const versionKey = (w: Series, item: Item, v: Version) => `${seriesKey(w)}#${versionAnchor(item, v)}`;
/** 品項鍵 `{發行方}/{流水號}#cd`，檢舉用 */
export const itemKey = (w: Series, item: Item) => `${seriesKey(w)}#${itemAnchor(item)}`;

export const resolveVersionKey = (key: string) => {
  const [sk, anchor = ""] = key.split("#");
  const [itemId, vid] = anchor.split("-");
  const series = getSeriesByKey(sk);
  const item = series ? getItem(series, itemId) : undefined;
  const version = item?.versions.find((v) => v.id === vid);
  return series && item && version ? { series, item, version } : null;
};

export const resolveItemKey = (key: string) => {
  const [sk, itemId] = key.split("#");
  const series = getSeriesByKey(sk);
  const item = series ? getItem(series, itemId) : undefined;
  return series && item ? { series, item } : null;
};

const norm = (s: string) => s.trim().toLowerCase();

/** 標籤撞到藝人名或別名就回傳那位藝人 */
export const resolveTagArtist = (tag: string) => {
  const t = norm(tag);
  return artists.find((a) => norm(a.name) === t || a.aliases.some((x) => norm(x) === t));
};

/** 合流用的標籤鍵：撞名的一律算成同一位藝人 */
export const tagKey = (tag: string) => {
  const artist = resolveTagArtist(tag);
  return artist ? `artist:${artist.slug}` : `tag:${norm(tag)}`;
};

export const shareHasTag = (share: Pick<Share, "about" | "tags">, tag: string) => {
  const key = tagKey(tag);
  return [...share.about, ...share.tags].some((t) => tagKey(t) === key);
};

export const sharesWithTag = (tag: string) => shares.filter((s) => shareHasTag(s, tag));

/** 主要系列：署名裡有他，共同署名兩邊都列 */
export const mainSeriesOf = (slug: string) => seriesList.filter((w) => w.credits.includes(slug));

export const guestSeriesOf = (slug: string) =>
  seriesList.flatMap((w) =>
    w.guests.filter((g) => g.artistSlug === slug).map((g) => ({ series: w, role: g.role, track: g.track })),
  );

export const compilationsOf = (slug: string) =>
  seriesList.flatMap((w) =>
    w.compilation.filter((c) => c.artistSlug === slug).map((c) => ({ series: w, track: c.track })),
  );

export const sharesOfSeries = (w: Series) => shares.filter((s) => s.link?.series === seriesKey(w));

export const creditNames = (w: Series) =>
  w.credits.map((slug) => getArtist(slug)).filter((a): a is Artist => Boolean(a));

/* ---------- 給畫面的平面資料（可以傳進 client component） ---------- */

export type ShareView = {
  n: number;
  what: string;
  /** 統一後的物件類型 */
  kind: Kind;
  /** 其他周邊的補充，或 CD-R 這類細分 */
  kindNote?: string;
  refPhoto?: boolean;
  story: string;
  time: string;
  order: number;
  about: string[];
  tags: string[];
  likes: number;
  color: string;
  image?: string;
  author: { handle: string; name: string; initials: string };
  link?: { href: string; label: string; seriesKey: string; itemId?: string; versionId?: string };
  /** 資料裡的出售狀態；本機改過的由 lib/state.tsx 疊上去 */
  sale: Sale;
  local?: boolean;
};

export const toShareView = (s: Share): ShareView => {
  const u = getUser(s.author);
  const w = s.link ? getSeriesByKey(s.link.series) : undefined;
  const it = w ? getItem(w, s.link?.item) : undefined;
  const v = it && s.link?.version ? it.versions.find((x) => x.id === s.link?.version) : undefined;
  return {
    n: s.n,
    what: s.what,
    ...(() => {
      const k = normKind(s.kind);
      return { kind: k.kind, ...(k.note ? { kindNote: k.note } : {}) };
    })(),
    ...(s.refPhoto ? { refPhoto: true } : {}),
    story: s.story,
    time: s.time,
    order: s.order,
    about: s.about,
    tags: s.tags,
    likes: s.likes,
    color: s.color,
    image: s.image,
    author: { handle: s.author, name: u?.name ?? s.author, initials: u?.initials ?? s.author.slice(0, 1) },
    link: w
      ? {
          href: it ? (v ? versionHref(w, it, v) : itemHref(w, it)) : seriesHref(w),
          label: [w.title, it?.kind, v?.edition].filter(Boolean).join(" › "),
          seriesKey: seriesKey(w),
          itemId: it?.id,
          versionId: v?.id,
        }
      : undefined,
    sale: s.sale ?? { state: "share" },
  };
};

export const allShareViews = () => shares.map(toShareView);

/** 我有／想要清單列（個人頁用） */
export type HoldingView = {
  key: string;
  title: string;
  artists: string;
  edition: string;
  year: string;
  format: string;
  catalog: string;
  href: string;
  color: string;
};

export const toHoldingView = (key: string): HoldingView | null => {
  const r = resolveVersionKey(key);
  if (!r) return null;
  return {
    key,
    title: r.series.title,
    artists: creditNames(r.series).map((a) => a.name).join("、"),
    edition: r.version.edition,
    year: r.version.year,
    format: r.item.kind,
    catalog: r.version.catalog,
    href: versionHref(r.series, r.item, r.version),
    color: r.version.color,
  };
};

export const allHoldingViews = () =>
  seriesList.flatMap((w) => w.items.flatMap((it) => it.versions.map((v) => toHoldingView(versionKey(w, it, v))))).filter(
    (h): h is HoldingView => h !== null,
  );

/* ---------- 搜尋 ---------- */

export const search = (query: string) => {
  const q = norm(query);
  if (!q) return { artists: [], series: seriesList, shares: [] as Share[] };
  const hit = (...xs: (string | undefined)[]) => xs.some((x) => x && norm(x).includes(q));
  return {
    artists: artists.filter((a) => hit(a.name, a.tagline, ...a.aliases)),
    series: seriesList.filter(
      (w) =>
        hit(w.name, w.seriesType, ...creditNames(w).flatMap((a) => [a.name, ...a.aliases])) ||
        w.items.some((it) => hit(it.kind) || it.versions.some((v) => hit(v.edition, v.catalog, v.barcode))),
    ),
    shares: shares.filter((s) => hit(s.what, s.story, ...s.about, ...s.tags)),
  };
};

/* ---------- 單則頁底部的相關收藏 ----------
 * 2026-09-26 系列層定案：同系列優先，其次同藝人（跟誰有關，或標籤撞到藝人名）。
 * 不放「同一位會員的其他收藏」；會員本人的其他則不排除也不優先。
 * 最多兩塊、每塊三張；來源不足三則的整塊不出現，不拿別的來源湊數。
 */
export type RelatedBlock = { title: string; href: string; total: number; items: Share[] };

export const relatedFor = (share: Share): RelatedBlock[] => {
  const others = shares.filter((s) => s.n !== share.n).sort((a, b) => b.order - a.order);
  const sources: { title: string; href: string; match: (s: Share) => boolean }[] = [];

  const series = share.link ? getSeriesByKey(share.link.series) : undefined;
  if (series) {
    sources.push({
      title: `${series.name}的其他收藏`,
      href: seriesHref(series),
      match: (s) => s.link?.series === share.link?.series,
    });
  }
  const artistsFirst = [...share.about, ...share.tags].filter((t) => resolveTagArtist(t));
  const seen = new Set<string>();
  for (const t of artistsFirst) {
    const key = tagKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    const name = resolveTagArtist(t)?.name ?? t;
    sources.push({ title: `跟${name}有關的其他收藏`, href: tagHref(name), match: (s) => shareHasTag(s, t) });
  }

  const used = new Set<number>();
  const blocks: RelatedBlock[] = [];
  for (const src of sources) {
    if (blocks.length === 2) break;
    const all = others.filter(src.match);
    const fresh = all.filter((s) => !used.has(s.n));
    if (fresh.length < 3) continue;
    const items = fresh.slice(0, 3);
    items.forEach((s) => used.add(s.n));
    blocks.push({ title: src.title, href: src.href, total: all.length, items });
  }
  return blocks;
};

/* ---------- 追蹤 ---------- */

/** 跟某位藝人有關的收藏：跟誰有關或標籤撞到藝人名（含別名） */
export const shareAboutArtist = (s: Pick<Share, "about" | "tags">, slug: string) => {
  const a = getArtist(slug);
  return a ? shareHasTag(s, a.name) : false;
};

/** 熱門藝人：相關收藏多的在前，只列藝人不列發行單位 */
export const hotArtists = (limit = 6) =>
  artists
    .filter((a) => a.kind === "藝人")
    .map((a) => ({ artist: a, count: sharesWithTag(a.name).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

/* ---------- 檢舉、鎖定、申訴（示範） ----------
 * 2026-09-26 定案：
 * - 單則收藏檢舉「盜版／仿冒」；系列裡的某個品項或版本檢舉「官方沒出過」（系列層定案）
 * - 只有認證帳號可檢舉，每個帳號對同一對象一次
 * - 達門檻（預設 10，可在管理後台調）＝醒目標示＋不能定價與出價＋既有出價凍結，內容照常可看
 * - 品項或版本被鎖，底下所有收藏都不能交易
 * - 被鎖的發文者向音藏申訴，管理者看過才解鎖，不自動解鎖
 */

export type ReportReason = "fake" | "never" | "other";

/** 對象鍵：`share:8`、`item:tide-highway/3#towel`、`version:faint-signal/1#cd-v1` */
export type TargetKey = `share:${number}` | `item:${string}` | `version:${string}`;
export type TargetLevel = "share" | "item" | "version";
export const shareTarget = (n: number): TargetKey => `share:${n}`;
export const itemTarget = (key: string): TargetKey => `item:${key}`;
export const versionTarget = (key: string): TargetKey => `version:${key}`;
export const targetLevel = (t: TargetKey): TargetLevel => t.slice(0, t.indexOf(":")) as TargetLevel;

/** 各層可選的理由 */
export const reasonsFor = (level: TargetLevel): { key: ReportReason; label: string }[] =>
  level === "share"
    ? [
        { key: "fake", label: "盜版／仿冒" },
        { key: "other", label: "其他" },
      ]
    : [
        { key: "never", label: level === "item" ? "官方沒出過這個品項" : "官方沒出過這個版本" },
        { key: "other", label: "其他" },
      ];

export const reasonLabel = (level: TargetLevel, r: ReportReason) =>
  reasonsFor(level).find((x) => x.key === r)?.label ?? "其他";

/** 達門檻後的醒目標示 */
export const lockLabel = (level: TargetLevel) =>
  level === "share" ? "多人檢舉：疑似盜版" : level === "item" ? "爭議品項：官方未證實發行" : "爭議版本：官方未證實發行";

export const DEFAULT_THRESHOLD = 10;

/** 其他人的檢舉，依理由計數 */
export const reportSeeds: { target: TargetKey; counts: Partial<Record<ReportReason, number>>; latest: string }[] = [
  { target: "share:8", counts: { fake: 10, other: 2 }, latest: "今天" },
  { target: "version:faint-signal/1#cd-v1", counts: { never: 10, other: 1 }, latest: "昨天" },
  { target: "share:9", counts: { fake: 4 }, latest: "2 天前" },
  { target: "item:mountain-radio/1#vinyl", counts: { never: 3 }, latest: "上週" },
  { target: "share:11", counts: { other: 2, fake: 1 }, latest: "上週" },
];

export const seedReportCount = (target: TargetKey) => {
  const r = reportSeeds.find((x) => x.target === target);
  return r ? Object.values(r.counts).reduce((a, b) => a + (b ?? 0), 0) : 0;
};

export type AppealStatus = "pending" | "unlocked" | "kept";
export type Appeal = {
  id: string;
  target: TargetKey;
  by: string;
  time: string;
  text: string;
  /** 證據照片：data URL */
  photos: string[];
  /** 示範資料沒有真照片，用說明文字畫成灰色塊 */
  photoNotes?: string[];
  status: AppealStatus;
};

export const appealSeeds: Appeal[] = [
  {
    id: "seed-1",
    target: "version:faint-signal/1#cd-v1",
    by: "rin",
    time: "昨天",
    text: "這張是 2019 年電台寄給主持人的宣傳片，我是從當時的主持人手上收的。附上電台寄件信封與樂團臉書當年的貼文截圖。",
    photos: [],
    photoNotes: ["電台寄件信封", "樂團臉書 2019 貼文"],
    status: "pending",
  },
];

/** 對象的顯示名稱與連結 */
export const describeTarget = (target: TargetKey): { level: TargetLevel; levelName: string; title: string; href: string } => {
  const level = targetLevel(target);
  const key = target.slice(target.indexOf(":") + 1);
  if (level === "share") {
    const n = Number(key);
    const s = getShare(n);
    return { level, levelName: "收藏", title: s?.what ?? `第 ${n} 則`, href: shareHref(n) };
  }
  if (level === "item") {
    const r = resolveItemKey(key);
    return r
      ? { level, levelName: "品項", title: `${r.series.name} › ${r.item.kind}`, href: itemHref(r.series, r.item) }
      : { level, levelName: "品項", title: key, href: "/" };
  }
  const r = resolveVersionKey(key);
  return r
    ? {
        level,
        levelName: "版本",
        title: `${r.series.name} › ${r.item.kind} › ${r.version.edition}`,
        href: versionHref(r.series, r.item, r.version),
      }
    : { level, levelName: "版本", title: key, href: "/" };
};

/** 一則收藏往上掛的品項與版本對象（版本或品項被鎖，底下收藏都不能交易） */
export const parentTargets = (link?: { seriesKey: string; itemId?: string; versionId?: string }): TargetKey[] => {
  if (!link?.itemId) return [];
  const out: TargetKey[] = [itemTarget(`${link.seriesKey}#${link.itemId}`)];
  if (link.versionId) out.push(versionTarget(`${link.seriesKey}#${link.itemId}-${link.versionId}`));
  return out;
};

/** 版本有沒有已知仿冒；給商品卡與單則頁的小標示 */
export const linkHasFakes = (link?: { seriesKey: string; itemId?: string; versionId?: string }) => {
  if (!link?.itemId || !link.versionId) return false;
  const r = resolveVersionKey(`${link.seriesKey}#${link.itemId}-${link.versionId}`);
  return Boolean(r?.version.fakes?.length);
};
