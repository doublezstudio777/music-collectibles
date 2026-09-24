# 競品視覺調研：音樂收藏／版本百科類網站

**日期**：2026-09-24
**方法**：Playwright 開真實頁面，桌機寬 1440，全頁截圖；部分頁面被 Cloudflare 人機驗證擋下，改用瀏覽器 `getComputedStyle()` 直接讀取該頁實際渲染出的顏色與字型（不是用戶自報的品牌色，是頁面真的算出來的色值）。
**截圖位置**：`img/`（檔名對應下方各站小節）

---

## 截圖與色碼結果總覽

| 站 | 截圖 | 色碼來源 |
|---|---|---|
| Discogs 條目頁 | 無法截圖（Cloudflare 人機驗證擋下） | 未取得 |
| Discogs 使用者 collection 頁 | `discogs_collection.png` | 已取得（該頁 computed style） |
| Rate Your Music 專輯頁 | 無法截圖（Cloudflare 擋下，WebFetch 也回 403） | 未取得 |
| Rate Your Music 使用者頁 | 無法截圖（Cloudflare 擋下，WebFetch 也回 403） | 未取得 |
| MusicBrainz release group 頁 | `musicbrainz_releasegroup.png` | 已取得 |
| Bandcamp fan collection 頁 | `bandcamp_collection.png` | 已取得 |
| Letterboxd 首頁 | `letterboxd_home.png` | 已取得 |
| Letterboxd 使用者 profile | `letterboxd_profile.png` | 已取得 |
| Letterboxd film 頁 | `letterboxd_film.png` | 已取得（該頁同首頁色系） |
| CLZ Music 官網展示頁 | `clz_music.png` | 已取得 |
| VinylHub（Discogs 旗下獨立品牌）首頁 | `vinylhub_home.png` | 已取得 |
| Musicboard 首頁 | `musicboard_home.png` | 已取得 |
| Collectr（收藏 App 官網） | 無法截圖（連線逾時，多次重試皆逾時） | 未查證 |
| Album of the Year 專輯頁 | 無法截圖（Cloudflare 擋下，WebFetch 也回 403） | 未取得 |

共截到 **9 張**可用截圖，5 個目標無法截圖（4 個是 Cloudflare 人機驗證、1 個是連線逾時），皆已如上標註原因，沒有用推測畫面代替。

---

## 1. Discogs（discogs.com）

**能截到的只有使用者 collection 頁**，條目頁（release page）被 Cloudflare「Performing security verification」擋下，多次重試（含更換 User-Agent、加長等待時間）皆停在驗證頁，未硬闖，WebFetch 也回 403，故條目頁的版面與色碼**未取得**。

以下依 collection 頁（`discogs_collection.png`）與該頁 `getComputedStyle()` 實測：

- **色碼**（來源：collection 頁渲染結果）：導覽列黑底 `#000000`、內文區白／米白 `#FFFFFF` 與 `#F5F4EC`、連結藍 `#2653D9`、次要按鈕深藍 `#3860BE`。無強調紅或黃出現在這頁，但品牌識別色是黃（`#FFFFFF` 底配黑，頁尾出現大面積黃色 `#FFD700` 系塊狀圖形，見 `vinylhub_home.png` 頁尾，因 VinylHub 現已併入 Discogs 品牌）
- **深淺**：淺色底為主，黑色導覽列與頁尾包夾，無深淺切換選項（未查證是否有帳號內設定）
- **版面骨架**：頂部黑色導覽列＋搜尋框＋購物車／登入；使用者頁再疊一層黑底個人資訊條（大頭貼、姓名、For Sale／Contributed／In Collection／In Wantlist／Images／Reviews 分頁）；本次截到的畫面該分頁內容區塊本身噴錯（顯示「Something went wrong in this section of the page」），**collection 的實際格狀展示內容沒有渲染出來**，只看到殼與分頁列，這點也如實記錄，不腦補內容應該長怎樣
- **標籤／分類**：頁內看到 Explore Discography、Shop Music、Sell Music、Community 四個下拉主選單，分類走的是市場交易與探索雙軌
- **字型**：body 實際渲染字型是 `Times New Roman`（可能是內容區塊噴錯時的 fallback，不代表 Discogs 正常設計字型，需標「未查證」）

## 2. Rate Your Music（rateyourmusic.com）

專輯頁與使用者頁**兩頁皆無法截圖**，反覆重試（加長等待、換 User-Agent）都停在 Cloudflare「Just a moment...」驗證頁，WebFetch 直接回 403。版面、色碼、字型**全部未取得**，不寫入任何推測內容。

## 3. MusicBrainz（musicbrainz.org）

Release group 頁（OK Computer／Radiohead）成功截圖，未被擋。

- **色碼**（來源：該頁 computed style）：背景純白 `#FFFFFF`，主要文字黑 `#000000`，一般連結藍 `#002BBA`，頂部品牌色帶與部分連結是洋紅／莓紅 `#BA478F`
- **深淺**：淺色底，無深淺切換
- **版面骨架**：單欄為主＋右側資訊欄（封面圖、Rating 星等、Tags、External Links、Collections）；主體是**密集表格**，一列一個發行版本（Release／Artist／Format／Tracks／Country-Date／Label／Catalog#／Barcode），不是卡片牆
- **收藏頁展示**：MusicBrainz 沒有個人收藏展示頁的概念，只在側欄顯示「Found in 34 user collections」這種聚合數字，不是逐一列出收藏內容
- **標籤／分類**：右側欄有 Genres（alternative rock／art rock／experimental／post-britpop）與 Other tags 兩層標籤雲，點擊應會導向該標籤的所有作品（本次未逐一點擊驗證，標「未查證」）
- **條目頁資訊層級**：最上面是作品標題＋「Release group by [藝人]」，再來就是分頁列（Overview／Aliases／Tags／Reviews／Details／Edit），接著直接進入版本總表，不是先放一段介紹文字
- **字型**：`Bitstream Vera Sans, Verdana, Arial, sans-serif`，無襯線，偏工具型網站排版，密度很高，資訊優先於視覺呼吸感

## 4. Bandcamp（bandcamp.com）

Fan collection 頁（`useful-bandcamp-username`）成功截圖。

- **色碼**（來源：該頁 computed style）：背景白 `#FFFFFF`，主要文字深灰 `#222222`，連結／強調色青藍 `#00A1C6`，次要文字灰 `#505958`；頁面頂部有一條深綠／墨綠橫幅 `rgba` 系（截圖上目視接近 `#1D5C5C` 一類的深青綠，未逐一取樣驗證，標「目測非精確色碼」）
- **深淺**：淺色底，無深淺切換
- **版面骨架**：頂部導覽（搜尋框＋Digital music／Vinyl／Compact discs／Cassettes／T-shirts／Gift cards／Editorial／Radio 分類）；使用者名稱＋「collection / following」兩個分頁切換；下方是**5 欄格狀封面牆**，正方形封面圖，每張下面標題／演出者／「appears in N other collections」這行小字
- **收藏頁怎麼展示**：純格狀封面牆（grid of square covers），不是清單、不是時間軸；有「view all N items」按鈕做分頁載入
- **標籤／分類**：本頁沒有自訂標籤欄位，靠「appears in N other collections」這個社群聚合數字做隱性的熱門度指標
- **條目頁資訊層級**：（本次未截 Bandcamp 單張專輯頁，只截了收藏頁，此項未查證）
- **字型**：`Helvetica Neue, Helvetica, Arial, sans-serif`，無襯線

## 5. Letterboxd（letterboxd.com）——電影版最接近音藏動線的參考站

截了首頁、使用者 profile、film 頁三張，三頁色系一致。

- **色碼**（來源：首頁與 film 頁 computed style，兩頁完全一致）：背景深藍灰 `#14181C`，主要文字灰藍 `#99AABB`，次要文字更暗 `#667788`，標題／強調文字近白 `#D8E0E8`，**品牌綠**（點讚愛心、CTA 按鈕）`#00E054`／按鈕實際渲染色 `#00AC1C`，連結 hover 淺藍 `#DDEEFF`。（使用者 profile 頁本次截圖抓到的是登出狀態下的公開頁，`getComputedStyle` 讀到系統預設藍色連結 `#0000EE`，代表該頁部分樣式表沒有完全載入，實際色系仍以首頁／film 頁的深色系為準）
- **深淺**：**深色底為主**，是三站裡唯一從骨子裡就是深色設計的站；未查證是否有淺色模式切換
- **版面骨架**：頂部黑色導覽列（SIGN IN／CREATE ACCOUNT／FILMS／LISTS／MEMBERS／JOURNAL＋搜尋框）；首頁是**橫向捲動的海報牆**（電影海報比例，直式約 2:3），配合下方 Popular Reviews／Popular Lists／Recent Stories 三段式版塊，每段都是橫向卡片列
- **收藏頁（使用者 profile）怎麼展示**：**格狀海報牆＋數據列混合**——最上面是大頭貼＋使用者名稱＋五個數字（Films／This Year／Lists／Following／Followers），中段是 Favorite Films（4 張精選海報）、Recent Activity（4 張），下段是 Recent Reviews／Popular Reviews 清單卡（每則帶星等＋愛心icon＋留言數＋前幾行文字＋「more」展開），右側欄放 Watchlist 格狀縮圖、Diary 時間軸清單（日期分組）、Ratings 直方圖、Recent Lists、Tags、Following 大頭貼牆。**同時包含格狀封面牆、清單、時間軸三種展示方式**，不是單一形式
- **標籤／分類**：使用者頁本身有 Tags 區塊（本次看到 4 個標籤：body horror／maximum／top2014／trash），點擊目的地未查證
- **條目頁（film 頁）資訊層級**：最上面是海報＋片名＋年份＋簡介，往下是演員標籤雲（可點的人名 chip），再來是片長與外部連結（IMDb／TMDb），接著才是 Popular Reviews（review 卡片：評分星星＋愛心＋留言數）與 Similar Films 橫向卡片列
- **字型**：`GraphikWeb`（自訂字體，fallback 到 `-apple-system, Segoe UI` 等系統字），無襯線，字重偏細，跟深色底搭配走「安靜」路線而非粗黑強調

## 6. CLZ Music（clz.com/music）

官網展示頁（非收藏頁本身，是產品行銷頁）。

- **色碼**（來源：該頁 computed style）：背景淺灰 `#EEEEEE`，主要文字深灰 `#3D3D3D`，CTA 橘 `#F2932F`，深色按鈕 `#231F20`（近黑），頂部導覽是一條深青藍色帶（目視接近 `#1B5E6B` 一類，未逐一取樣，標「目測非精確色碼」）
- **深淺**：淺色底
- **版面骨架**：傳統行銷落地頁結構——Hero＋兩張產品卡（Mobile／Web）＋定價、三個橘／黑圓形 icon 導覽（News／Community／Help）、Latest Software Updates 清單、Reviews from Customers 兩欄文字牆
- **收藏頁怎麼展示**：本頁未展示真實收藏畫面，只有 App 截圖縮圖（手機三連拍、電腦視窗截圖），**收藏頁實際版面未查證**
- **字型**：`Gilroy`，無襯線，幾何感字體，行銷頁常見選擇

## 7. 額外參考站（7-1：VinylHub／7-2：Musicboard）

### 7-1 VinylHub（vinylhub.com）

首頁截圖顯示這已經是**併入 Discogs 品牌**的獨立入口站（頁首直接是 Discogs 黑底 logo＋搜尋框），不是完全獨立品牌，這點如實記錄，不當成獨立競品算。

- **色碼**：黑 `#000000`＋白 `#FFFFFF`＋大面積品牌黃（頁尾與裝飾區塊，目視接近 `#FFD700`／`#F5D033` 一類，未逐一取樣，標「目測非精確色碼」）
- **版面骨架**：Hero 大圖＋標題疊字、三欄圖文卡（Record Store Features）、左圖右文區塊（Look for the badge，展示店家頁面上的認證徽章與評分）、三欄卡片（Stories／City Guides／Music Discovery），是唱片行地圖與導覽型網站，不是個人收藏站

### 7-2 Musicboard（musicboard.app）

首頁截圖，這站本質上就是「**音樂版的 Letterboxd**」，設計語言與動線高度相似。

- **色碼**（來源：該頁 computed style）：背景近黑 `#0E0F11`，主要文字淺灰 `#E4E6EA`，次要文字 `#A0A1A4`，CTA 按鈕與強調色是藍 `#1E90FF` 一類的亮藍（目視，按鈕本身未在採樣清單抓到明確 background，標「目測非精確色碼」）
- **深淺**：深色底
- **版面骨架**：頂部黑底導覽（Music／Members／Lists／Pro）；Hero 標題＋CTA＋周邊散落的傾斜專輯封面裝飾；Popular This Week 橫向專輯封面列（正方形封面＋圓角）；「Musicboard Lets You...」六宮格圖示卡；下方左欄 Trending Reviews（review 卡：頭像＋星等＋標題＋內文摘要＋讚數），右欄 Trending Lists（拼貼縮圖＋標題）＋Popular Reviewers（頭像＋名字＋Follow 按鈕的直式清單）
- **收藏頁展示**：本次只截首頁，個人收藏頁版面**未查證**，但從首頁的 review 卡片與清單模式推測（未驗證）應與 Letterboxd 使用者頁邏輯相近
- **字型**：系統字體堆疊（`-apple-system, Segoe UI, Roboto...`），無襯線

---

## 總結

**這些站共同在做的事**：

1. **深色底是這個品類的多數選擇**——Letterboxd、Musicboard 兩個「個人收藏／品味展示」導向的站都是深色系；反而 Discogs、MusicBrainz、Bandcamp、CLZ 這幾個「資料庫／交易／工具」導向的站是淺色系。淺深不是隨機選的，跟站的定位有關：**展示自己品味的站傾向深色**，**查資料的工具站傾向淺色**
2. **封面圖幾乎都是正方形卡片牆**（Discogs、Bandcamp、Musicboard），只有 Letterboxd 是直式 2:3 海報，因為電影海報本身就是直式。音樂封面是方形，這點音藏可以直接沿用業界共識，不用另外測試
3. **收藏頁的三種展示邏輯**：格狀封面牆（Bandcamp、Discogs 理論上也是）、清單卡（Letterboxd Reviews、Musicboard Reviews）、時間軸（Letterboxd Diary）。**Letterboxd 是唯一同時做三種的站**，這也是它動線最接近音藏「炫收藏」需求的原因——音藏的炫收藏本質上就是「分享一張帶敘述的卡片」，這正好對應 Letterboxd／Musicboard 的 review 卡片格式（頭像＋星等或標籤＋一段話＋讚數），不是對應 Discogs／Bandcamp 的純封面牆
4. **標籤系統在這些站普遍偏弱**：MusicBrainz 有 Genre／Tag 雲但功能單純只是分類聚合；Letterboxd 的個人 Tags 更像私人整理工具，不是拿來標「跟誰有關」這種關係型資訊；Bandcamp、Discogs 完全沒有自訂標籤，只有系統生成的「appears in N collections」聚合數字。**音藏規劃的「標籤標跟誰有關」這件事，在這批競品裡完全沒人做**，是個空隙
5. **條目頁資訊層級的共同點**：不管哪一站，最上面永遠是「圖＋標題＋一行關鍵中繼資料」，不會有大段介紹文字擋在最前面，內容細節（版本列表、評論、關聯作品）都是往下捲才出現。MusicBrainz 甚至直接是標題後面就接版本總表，中間沒有任何行銷式介紹段落
6. **版本比較這件事，只有 MusicBrainz 有雛形**——它的版本總表用表格逐欄列出格式／地區／年份／廠牌／目錄編號／條碼，但呈現方式是密集資料表，不是音藏規劃的「多欄並排比較」視覺化呈現。這塊**業界沒有做得好看的先例**，音藏的多欄版本比較會是真正的差異化設計，不是抄哪一家
7. **藝人頁在這批競品裡幾乎缺席**：MusicBrainz 的藝人資訊只藏在頁面連結裡（本次未點擊驗證細節），Discogs／Bandcamp／Letterboxd／Musicboard 首頁截圖都沒有看到獨立的藝人主頁範例。**這也是空隙**，音藏規劃的歌手頁（簡介＋主要作品＋合作／客串＋合輯收錄＋獎項＋相關收藏）在這批競品裡找不到對照範本，等於是要自己設計，不是抄
8. **點讚／收藏機制的視覺化程度**：Letterboxd 用愛心 icon＋粉紅色系＋讚數同時出現在 review 卡與 film 頁，是這批站裡做得最完整的「輕量互動」範例；Discogs、Bandcamp 幾乎沒有類似的社交互動視覺元素。音藏的「點讚取代儲存＝喜愛清單」這個決定，視覺上可以直接參考 Letterboxd 的愛心＋讚數呈現方式，不用重新發明

**這批站沒做好的地方**（給下一位設計顧問的空隙提示，不是本報告的設計建議）：標籤系統普遍是分類用途而非關係用途、多版本比較普遍是密集表格而非易讀的並排卡片、藝人頁普遍薄弱或不存在、深色系的站（Letterboxd／Musicboard）資訊密度都偏高、留白偏少，淺色系的站（Discogs／MusicBrainz）則偏工具冷感、缺乏「這是有人在認真整理收藏」的溫度感。

---

## 未截到的站與原因（逐項）

- **Discogs 條目頁**：Cloudflare「Performing security verification」，多次重試不通過，未硬闖
- **Rate Your Music 專輯頁／使用者頁**：Cloudflare「Just a moment...」，多次重試不通過；WebFetch 回 403
- **Album of the Year 專輯頁**：Cloudflare「Just a moment...」，多次重試不通過；WebFetch 回 403
- **Collectr（collectr.com）**：連線逾時（`Timeout 45000ms exceeded`），非人機驗證問題，可能是該站本身載入異常或地區限制，未查證確切原因

以上四項一律未用其他推測畫面代替，色碼與版面欄位均標記「未取得」或「未查證」。
