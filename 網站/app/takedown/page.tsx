import Link from "@/components/link";
import { TakedownForm } from "@/components/takedown-form";
import { CONTACT_EMAIL } from "@/lib/legal";

export const metadata = { title: "權利侵害通知" };

// 權利侵害通知（2026-10-01 法務修正 M5）：著作權法網路服務提供者章節要求公告的聯繫窗口與三次侵權終止服務，都寫在這頁與使用條款第 11 條
export default function TakedownPage() {
  return (
    <main id="main" className="wrap page page-narrow legal">
      <h1 className="page-title">權利侵害通知</h1>
      <p>認為站上的照片、文字或其他內容侵害你的著作權、商標權、肖像權或其他權利，可以用這張表單通知我們，或寄信到 <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>。</p>
      <ul>
        <li>我們收到完整的通知後，會儘快移除該內容或讓他人無法瀏覽，並通知發布的會員</li>
        <li>會員認為沒有侵權，可以提出回復通知。我們會轉給你；你在收到後 10 個工作日內沒有提出已經起訴的證明，我們會回復該內容</li>
        <li>會員經確認侵害他人著作權達三次，我們會終止該帳號的全部服務</li>
        <li>
          通知內容（不含你的 Email、電話、地址）會轉給被通知的會員。處理方式詳見<Link href="/terms#takedown">使用條款第 11 條</Link>
        </li>
      </ul>
      <p className="legal-meta">侵權通知的聯繫窗口：{CONTACT_EMAIL}</p>
      <h2>送出通知</h2>
      <TakedownForm />
    </main>
  );
}
