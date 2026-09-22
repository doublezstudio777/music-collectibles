import { MyCollection } from "@/components/my-collection";

export const metadata = { title: "我的收藏｜音藏" };

export default function MePage() {
  return (
    <main className="catalog-shell">
      <div className="catalog-heading">
        <h1>我的收藏</h1>
        <p className="heading-note">
          我有、我想要與已儲存分開記。已儲存是留著以後看，不表示你持有。
        </p>
      </div>
      <MyCollection />
    </main>
  );
}
