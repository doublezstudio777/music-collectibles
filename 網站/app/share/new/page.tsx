import { getViewer, pageData } from "@/lib/server/viewer";
import { ShareForm } from "@/components/share-form";

export const metadata = { title: "炫收藏" };

/**
 * 這頁不吃整頁快取（worker.ts 明確排除 /share/new），所以可以放心讀登入者：
 * 表單預設藝人清單要把「這位會員自己最近選過的」排最前面（2026-09-28 表單藝人預設）。
 */
export default async function NewSharePage() {
  const { c } = await pageData();
  const viewer = await getViewer();
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">炫收藏</h1>
      <ShareForm options={c.formOptions(viewer?.handle)} />
    </main>
  );
}
