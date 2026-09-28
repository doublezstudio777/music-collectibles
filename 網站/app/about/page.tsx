import { ogMeta } from "@/lib/server/og";
import { siteOrigin } from "@/lib/server/viewer";
import { SITE_NAME } from "@/lib/data";

const PARAS = [
  `大家開始用串流聽歌之後，會去買實體專輯的人越來越少。唱片公司壓的量跟著變少，有一段時間發行的專輯，到了現在幾乎已經找不到了。`,
  `想找一張絕版專輯，常常只能到社團裡問：這是哪一版？首批還是再版？賣家開的價格合不合理？答案散在少數老收藏家的腦袋裡，新來的樂迷問不到，也分不出手上那張是不是對岸做的仿冒品。`,
  `我做${SITE_NAME}，是想把這些知識攤開來。每個人把手上的收藏拍下來、寫清楚，同一張專輯的不同版本就能放在一起比對，哪些是正版、哪些被仿冒過，查得到也看得懂。`,
  `錯過那幾年的人，也能在這裡看到當時發了哪些東西、長什麼樣子。`,
];

export async function generateMetadata() {
  return ogMeta({
    origin: await siteOrigin(),
    path: "/about",
    title: `關於${SITE_NAME}`,
    description: PARAS[0],
    photo: null,
  });
}

export default function AboutPage() {
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">關於{SITE_NAME}</h1>
      <section className="block prose">
        {PARAS.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <p className="about-sign">{SITE_NAME}站長</p>
      </section>
    </main>
  );
}
