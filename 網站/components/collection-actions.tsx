"use client";

import { Archive, Bookmark, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCollection } from "@/lib/collection";

export function CollectionActions({ versionKey }: { versionKey: string }) {
  const { has, toggle, ready } = useCollection();
  const owned = has("owned", versionKey);
  const wanted = has("wanted", versionKey);

  return (
    <div className="collection-actions">
      <Button
        className="collection-button"
        variant={owned ? "default" : "outline"}
        onClick={() => toggle("owned", versionKey)}
        aria-pressed={ready ? owned : undefined}
      >
        {owned ? <Check aria-hidden="true" /> : <Archive aria-hidden="true" />}
        {owned ? "已在收藏" : "我有這個版本"}
      </Button>
      <Button
        className="collection-button"
        variant={wanted ? "secondary" : "outline"}
        onClick={() => toggle("wanted", versionKey)}
        aria-pressed={ready ? wanted : undefined}
      >
        <Bookmark aria-hidden="true" />
        {wanted ? "已加入想要" : "加入想要清單"}
      </Button>
    </div>
  );
}

/** 分享卡片的動作列。「儲存」是留著以後看，不表示持有 */
export function ShareActions({ shareId, versionKey }: { shareId: string; versionKey: string }) {
  const { has, toggle } = useCollection();
  const saved = has("saved", shareId);
  const owned = has("owned", versionKey);
  const wanted = has("wanted", versionKey);

  return (
    <footer className="share-actions">
      <button type="button" onClick={() => toggle("saved", shareId)} aria-pressed={saved}>
        {saved ? "已儲存" : "儲存"}
      </button>
      <button type="button" onClick={() => toggle("owned", versionKey)} aria-pressed={owned}>
        {owned ? "已在收藏" : "我也有"}
      </button>
      <button type="button" onClick={() => toggle("wanted", versionKey)} aria-pressed={wanted}>
        {wanted ? "已加入想要" : "加入想要"}
      </button>
    </footer>
  );
}
