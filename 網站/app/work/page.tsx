import { Suspense } from "react";
import { WorkIndex } from "@/components/work-index";

export const metadata = { title: "作品與版本｜音藏" };

export default function WorkIndexPage() {
  return (
    <main className="catalog-shell">
      <div className="catalog-heading">
        <h1>作品與版本</h1>
        <p className="heading-note">
          先找作品，再往下看它有幾個版本。找不到手上那件的話，可以提出候選版本。
        </p>
      </div>
      <Suspense fallback={<p className="quiet-label">載入中</p>}>
        <WorkIndex />
      </Suspense>
    </main>
  );
}
