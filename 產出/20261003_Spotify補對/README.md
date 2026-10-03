# Spotify 補對＋熱門歌曲區塊提前（2026-10-03）

Cloudflare Version ID `c24899f3`，沒有遷移。部署前備份 `20261003-023250-remote`（寫 Spotify ID 前）、`20261003-023949-remote`（deploy.sh 第 3 步）。

## 一、藝人 Spotify ID 補對

正式站 active 藝人 343 位（`kind='藝人' AND status='approved'`，未刪未隱藏）。改前 151 位有 ID、192 位沒有；改後 **200 位有 ID、143 位沒有**。

- 跑 `網站/scripts/spotify-match.mjs --remote`（規則不變：MusicBrainz 連結優先→手動歌單→搜尋名稱完全相同且作品交集），只用 search 與 get artist，沒打 artist-albums；Spotify 連線 190 次、間隔 1 秒、429 0 次
- 腳本兩處改動：①任何 429 立刻停並存檔（原本短 Retry-After 會等）②`splitNames()`：中英連寫（JOLIN蔡依林）、括號別名（楊淑喻（吉那））、／分隔（Yufu／陳郁夫）都拆開當搜尋名與比對名
- 這次新對到 49 位（舊 151 位全部不變、沒有改判）：MusicBrainz 16（理想混蛋、Hyukoh、路壹 Lu1、JOLIN蔡依林、鶴The Crane、我是機車少女I'mdifficult、J.Sheon、雷擎、LINION、MANDARK、wannasleep、魚條、BRBP、COLD DEW、debloop）、搜尋 33（ADOY、A_Root同根生、Acid Brain酸腦、Tickle Tickle癢癢、Age Factory、BRADD、陳穎達、陳子彰、Dac、Dizparity、Fat Hamster and KANG New、.Feast、Flowstrong、FTK、FUTURE AFTER A SECOND、劉暐、Lomba Sihir、LÜCY、呂紹淳、馬尾、NaraBara、NIO、Oberka、Plutato、PROD_CW、PUZZLEMAN、SHNTI、蘇裔非、TeacheRay、undep、溫室雜草、Wring Out Laura、楊舒雅、楊易修）。每位的證據在 `產出/20260930_Spotify自動抽歌/藝人對應報告.json` 的 `ok`
- 疑義 98 位（舊 38 維持＋舊「找不到」拆名後變疑義 17＋新藝人 43）→ `待確認清單.md`，**沒寫進站**；找不到 45 位不配
- 已寫進正式站 `spotify_artists`（200 列、啟用 200；新 49 位 `albums` 為空，每晚 02:00 排程照清單桶每日 60 的上限抽，估 1 晚補齊）

## 二、區塊位置

- 原本：「在 Spotify 上的熱門歌曲」獨立區塊排在「系列」之後，手機要捲過整排系列才看得到
- 現在：區塊移進藝人頭部 `<header class="artist-head">`，標題「Spotify 熱門歌曲」＋小字「由 Spotify 提供」
  - 手機（≤700）：整寬排在照片＋資訊、「投稿藝人照片」之下、「系列」之前，播放器 352px。152 版面在 390 寬只看得到 3 首半、曲名字小又被截（`img/本機_改後/390_*_播放器152.jpg` vs `_播放器352.jpg`），所以選 352
  - 桌機：第三欄 400px 寬，頂對齊照片、在文字右邊，播放器 152px 精簡版。Spotify 嵌入只有 152 與 352 兩種版面，中間高度（試過 248）會畫成 152 下面留一截空白；352 會比 280px 直式照片高、把系列再往下推 100px，所以用 152。1440 寬「系列」標題在 390px 處，仍在第一屏
  - 沒有 Spotify ID 的藝人整段不渲染，頭部高度＝照片或文字（驗收有量）
- 投稿列 DOM 在 Spotify 之前；桌機用 `order: 1` 讓它換到最後一列，手機 `order: 0` 緊貼照片

## 驗收

- `_驗收_區塊位置.py`：WebKit 390／320（3x、iPhone UA）、1440，量區塊在頭部之內、排在系列之前、整寬／第三欄、播放器高度、沒 ID 不留空位、無溢出、無 console error
  - 本機建置版 68/68（gordon 無照片有 ID、陳綺貞有照片有 ID、李英宏有照片沒 ID、落日飛車都沒有）→ `驗收結果_本機_改後.json`
  - 正式站 56/56（gordon、hyukoh 有 ID；li-ying-hong 沒 ID）→ `驗收結果_正式站_改後.json`
- `_驗收_Spotify播放.py`：iPhone WebKit 390 正式站實際點播放，hyukoh、gordon 都從 Play 變 Pause（未登入 Spotify 是 30 秒試聽）→ `img/正式站_改後/390_Spotify_*_播放前後.jpg`
- 改前對照：`img/正式站_改前/`（部署前的正式站，gordon、hyukoh、li-ying-hong）

## 本機注意

本機 D1（`.wrangler/state`）原本沒有 `spotify_artists` 資料、也沒套 0028／0029，這次套了遷移並塞 gordon、陳綺貞兩筆 Spotify ID 當驗收用（本機測試資料，不影響正式站）。

## 三、第二輪自動判定（2026-10-03 深夜）

疑義 98 位太多，不能全丟給使用者逐一點。新寫 `網站/scripts/spotify-second-pass.mjs` 用額外證據再判一次，採用的寫進 `網站/scripts/spotify-manual.json` 再 `spotify-match.mjs --remote --apply`。寫入前備份 `20261003-030447-remote`。結果：**採用 64、空殼不配 12、仍待使用者 22**，正式站 `spotify_artists` 200 → **264 列啟用**（新 64 位 `albums` 為空，等每晚 02:00 排程抽）。完整名單與每位的證據在 `第二輪判定.json`，給使用者看的是 `用戶確認_精簡版.md`。

證據與採用數：
- `wikidata-p1902` 3：Wikidata P1902（Spotify artist ID）。QID 來自 MusicBrainz 的 Wikidata 連結、10/1 補匯的 `pending-result.json`、站上 `wiki_url` 的 pageprops。ATARASHII GAKKO!、李英宏（Wikidata 給的 ID 跟第一輪的同名候選不同，第一輪抓到的是空殼）、熊仔
- `wikidata-search` 2：Wikidata 同名項目（只認站上主名稱與中文段，別名「The Wanted」會對到英國男團，已擋）的 P1902 正好是同名候選。HUSH、柯智豪
- `musicbrainz` 0：16 位有 MBID 的重查 url-rels，沒有新增 Spotify 連結
- `search-title` 38：拿站上已知作品（系列標題優先、再入圍作品與簡介《》、跨藝人合輯不搜）去 Spotify search（album＋track），結果對全部已知作品累計命中。同一演出者命中 ≥2 個作品（Spotify 名稱可以跟站上不同：呂士軒＝TroutFresh、淺堤＝Shallow Levée、裘德＝Jude Chiu、胖虎＝punkhoo、江惠儀＝Joey Chiang）、或命中 1 個且名稱相符。第一輪只用 `artist:名` 抓前 10 張，作品多的或 Spotify 用英文名的都漏了，這條救回最多
- `single-cjk-empty` 14：唯一同名候選、站上名稱含中文、站上沒有已知作品（或只有跨藝人合輯）、候選有作品且像華語圈藝人（Spotify 名稱含中文或作品標題有中文）。純英文名＋純英文作品的不採用（「AAA」會對到日本團，「Roger Lin」太常見）
- `multi-only-real` 6：多位同名候選只有一位有作品，其他是沒作品沒照片的空殼；或那位的作品有中文標題／跟站上作品相同。阿跨面、黃子軒、翁立友、吳永吉、C.Holly、ELLE SHIMADA、KbN
- `single-works-hit` 1：唯一候選補搜到的作品跟站上相同（高金龍 SAITIKOTIKO/一次又一次）
- 空殼不配 12：候選沒頭像也沒作品、作品搜尋也對不到（荒井十一、黃綺珊、張羽涵、利惟庸、林鈺婷、王OK、蘇郁涵、楊淑喻（吉那）、張凱婷、鄭嘉富、鄭敬儒、鄭楠）。就算是本人，播放器也沒東西可放，先當找不到

規格裡「Spotify genres 含 taiwan／mandopop」那條用不上：這個 app 的 Spotify 回應（search 與 get artist）只有 id、name、images、external_urls，沒有 genres、followers、popularity。配額：第二輪 Spotify 只打 search 共 163 次（1 秒 1 次、429 0 次）、`--apply` 對 64 個手動 ID 各打一次 get artist；MusicBrainz 16、Wikidata 171、維基 11。

重跑說明：`spotify-match.mjs --apply` 之後第一輪報告會把手動指定的算進 ok，疑義只剩沒採用的；要重現 98 位的判定要用 git 裡 apply 前的報告：`node scripts/spotify-second-pass.mjs --remote --report <舊報告> [--write]`。已寫進 `spotify-manual.json` 的沿用不重判，要重判就刪那條。

驗證：正式站 `/artist/lv-shi-xuan`、`/artist/tiu-tiu`、`/artist/li-ying-hong`、`/artist/xiong-zai` 的 HTML 都有 `open.spotify.com/embed/artist/{新 ID}`，跟 manual 檔一致。

## 四、收尾：只配顯示中的藝人＋出現時自動配（2026-10-03 上午）

使用者 10/03 原話：「AAA 不是。其他的我不知道耶。我覺得比較重要的是，只要已經有頁面的就要出現，沒有的就算了，等真的有出現再加上去。」

Cloudflare Version ID `c2025047`，遷移 `0030_spotify_match`（只新增 `spotify_match` 一張表＋種子資料，沒有重建表）。寫正式站前備份 `20261003-084202-remote`，部署第 3 步備份 `20261003-085319-remote`。

### 顯示中藝人（照現行顯示規則，會 404 的不算；正式站 `/artists` 列出的 153 位）

| | 有 Spotify ID | 沒有 | 比例 |
|---|---|---|---|
| 改前 | 137 | 16 | 89.5% |
| 改後 | 146 | 7 | 95.4% |

新採用 9 位（正式站藝人頁都已嵌入，ID 跟 `spotify-manual.json` 一致）：
- 精簡版 22 位裡顯示中的：蘇運瑩＝Spotify「Sue」（有《冥明》〈野子〉〈螢火蟲〉；同名「蘇運瑩」只有《峨眉金曲》不是本人）、秀蘭瑪雅
- 顯示中、不在 22 位裡、用第二輪作品標題搜尋補到的 7 位：張淦勛（張淦勛 Giyu Tjuljaviya，《南迴之子》）、李權哲（Jerry Li，《愛情一陣風》《醒著不醉》）、潘子爵（Ruby Pan 潘子爵，《沒問題少女》）、傷心欲絕（Wayne's so Sad，3 張同名作品）、許哲珮（Peggy Hsu，《雪人》《許願盒》）、葉穎（葉穎 Leaf Yeh，《生滅》）、夜貓組（夜貓組 (Leo王+春艷)，《健康歌曲》）。證據在 `顯示中補對.json`

還沒對到的顯示中 7 位：阿洛·卡力亭·巴奇辣、荒井十一、黃綺珊、林鈺婷、蘇郁涵、鄭楠（Spotify 同名頁沒照片沒作品、作品標題也搜不到）、李銖銜（唯一候選 James Lee 確認不配）。每月重跑會再查。

精簡版 22 位的處理（寫在 `網站/scripts/spotify-manual.json`）：
- `rejected`：AAA（HYUKOH與落日飛車）整位不配，自動流程永遠不碰；Dac與鄭昭元、李銖銜、JIHU、KIKI、Roger Lin、葉俊麟只把看過的候選 ID 記成「不是本人」，日後出現新候選照規則判斷
- `whenVisible`：藝人頁還沒顯示、名稱或作品對得上的 13 位（富愛子、Brandon Lin、倒車入庫＝Reversing into Garage、DCIV、擊沈女孩、KNOWTIS、N.Y.P.D.南洋派對、Sonia Calico、That's My Shhh、圖靈音樂實驗室、Von Citizen、笑琴、Yufu 有作品那位）先存著，藝人頁一出現 Worker 直接寫入，不再比對
- 改這兩段後跑 `node scripts/spotify-match.mjs --remote --sync-decisions` 同步進 D1（這次的已經寫在遷移 0030 裡）

### 自動化（`網站/lib/server/spotify-auto.ts`）

- 觸發 A（藝人頁從不顯示變顯示）：內容目錄每次重組（內容版本一變就重組）算一次顯示中的藝人，清單有變就存 `spotify_state.visible`，同一句 SQL 替「顯示中、沒有啟用的 Spotify ID、沒排過」的藝人排一筆 `spotify_match`；`waiting`（使用者先判斷過的）也在這時轉排隊。比對過的不會因為重組再排
- 觸發 B（每月一次）：每天 02:00 的排程看 `auto_month`，月份變了就把顯示中、比對過但沒對到的全部重排。這個月已標成 2026-10，第一次是 11 月
- 執行：`*/10` 排程在自動補資料之前跑一小批（最多 20 次對外連線，用掉的從自動補資料的 45 次扣，整次不超過 50），共用 `autofill_state` 的排程鎖與 MusicBrainz 計時；Spotify 記在抽歌的配額帳新桶 `search`（每天上限 120），每秒最多 1 次、只打 search、不打 artist-albums；任何 429 立刻停、把 search 桶鎖到 Retry-After 之後並寫進 `auto_last`；鎖住或額度用完時整批不跑（連 MusicBrainz 都不打）。抽歌時段（台灣 02:00～04:59）不跑
- 規則：使用者確認過的 ID → MusicBrainz 唯一 Spotify 連結 → Wikidata P1902 → 名稱完全相同且作品交集唯一 → 作品標題搜尋（命中 ≥2 個或命中 1 個且名稱相符）。高信心直接寫 `spotify_artists`（source＝`auto`，albums 留空），讓 content_version 加 1 一次換上播放器；其餘記 none／doubt／shell 不配。確定不是本人的 ID、已配給別位的 ID 不用
- 寫入後每晚 02:00 抽歌排程照常接手（`drawn_on` 空的排最前）
- `spotify-match.mjs --apply` 不會停用 source＝`auto` 的列（原本會把不在對應檔裡的全部停用）
- 後台「推薦歌曲」頁新增「藝人自動比對」：上次自動比對時間、比對幾位、對到幾位（名單）、累計自動對到幾位、排隊數、還沒對到的顯示中藝人表格（狀態、說明、上次比對）。額度列多一項「藝人比對搜尋」。管理員 API `POST /api/admin/spotify-draw` 多 `match`（立刻跑一批）、`monthly`（立刻重排）

### 驗收

- 本機（`.wrangler/state`，套 0030）：部署後第一次重組就把 502 位顯示中沒 ID 的排進佇列（本機有示範資料），先全部標成比對過模擬穩定狀態；再替不顯示的周自從、Von Citizen 各加一個系列 → 兩頁 404→200，佇列只多這 2 位（reason＝visible）→ `match` 一批：周自從用「名稱相同＋作品交集《人造人間》」對到 `2eYVJwq3xrMAUfM9OFmzR9`（跟正式站第一輪結果相同）、Von Citizen 用使用者確認過的 ID；3 次 Spotify 連線，`spotify_artists` 兩列 source＝auto、albums 空、drawn_on 空（抽歌待抽清單有它們），content_version 加 1，兩頁 HTML 都有嵌入
- 本機觸發 B：`monthly` 只重排顯示中沒 ID 的 2 位，不顯示的不排；search 桶設成鎖住時 `match` 回 skipped、0 次連線、佇列不動
- 本機後台截圖 `img/本機_自動比對/後台_藝人自動比對.jpg`，console error 0
- 正式站：部署後 `spotify_state.visible`＝153，沒有新排隊（顯示中沒 ID 的 7 位都已有比對紀錄）；9 位新採用的藝人頁 HTML 都有 `open.spotify.com/embed/artist/{ID}` 且跟 manual 一致；Playwright 390 寬抽 3 位（蘇運瑩、秀蘭瑪雅、傷心欲絕）iframe 352px、console error 0，截圖在 `img/正式站_新採用/`
- 本機留下的測試資料（只在本機 D1）：周自從、Von Citizen 各一個系列（created_by＝`test:spotify-auto`）、兩列 auto 的 `spotify_artists`、管理員測試 session 一列
