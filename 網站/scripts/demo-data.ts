// 本機示範資料（全部虛構）。只給 scripts/seed-local.mjs 用，網站程式不 import 這支，
// 正式建置不會打包這些內容；正式資料庫一開始是空的（第 2 階段技術設計第十二節）。

import type { Appeal, Artist, Message, ReportReason, Sale, Series, Share, TargetKey, Thread, User, Version } from "../lib/data";

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
