import Link from "@/components/link";
import { getViewer, pageData } from "@/lib/server/viewer";
import { ShareForm } from "@/components/share-form";
import { myAdditions } from "@/lib/server/additions";

export const metadata = { title: "炫收藏" };

/**
 * 這頁不吃整頁快取（worker.ts 明確排除 /share/new），所以可以放心讀登入者：
 * 表單預設藝人清單要把「這位會員自己最近選過的」排最前面（2026-09-28 表單藝人預設）。
 */
export default async function NewSharePage() {
  const { c } = await pageData();
  const viewer = await getViewer();
  return (
    <main id="main" className="wrap page sf-page">
      <header className="page-head sf-head">
        <h1 className="page-title">炫收藏</h1>
        {/* 一張大合照標很多張專輯（2026-10-01 全家福合集） */}
        <Link className="btn btn-line" href="/share/collection" data-testid="to-collection">
          發合集
        </Link>
      </header>
      <ShareForm options={c.formOptions(viewer?.handle)} mine={viewer ? await myAdditions(viewer.id) : undefined} />
    </main>
  );
}
