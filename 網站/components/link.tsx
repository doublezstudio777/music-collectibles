"use client";

// 站內連結：包 next/link，全站一律從這裡 import Link，不要直接 import "next/link"（eslint 沒擋，靠這段註解與 README）。
//
// 預抓（prefetch）的歷史：
// - 2026-10-01 CPU 緊急修正：vinext 的 <Link> 預設「連結一進畫面就預取」，每個預取都是一次整頁伺服器渲染（RSC），
//   一頁常有 10～20 個連結，開一頁就同時打 10～30 個請求，免費方案每請求 CPU 10ms 撐不住（Error 1102，
//   產出/20261001_CPU超限緊急處理/）。當時全部關掉（prefetch={false}）。
// - 2026-10-01 升級 Workers Paid 後重新評估（產出/20261001_願望清單與自動補資料/README.md「預抓」）：
//   MODE 是全站預設，個別連結明寫 prefetch 可以蓋過去。
//   off＝不預抓；viewport＝vinext 預設（進畫面就抓＋滑鼠移上去、手指按下就抓）；intent＝只在滑鼠移上去時抓
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

type Mode = "off" | "viewport" | "intent";
// 2026-10-01 定：intent。量測（8 頁、iPhone 視窗、開頁＋捲到底）：viewport 272 個預抓（/artists 一頁就 154），intent 0 個；
// 滑鼠移到連結上才抓一頁（整頁抓好，點下去直接用、不再打第二次），手機點擊跟不預抓一樣一次請求
const MODE = "intent" as Mode;

export default function Link({ prefetch, onMouseEnter, ...props }: ComponentProps<typeof NextLink>) {
  const router = useRouter();
  if (prefetch !== undefined || MODE === "off") return <NextLink prefetch={prefetch ?? false} onMouseEnter={onMouseEnter} {...props} />;
  if (MODE === "viewport") return <NextLink onMouseEnter={onMouseEnter} {...props} />;
  // intent：滑鼠移上去時呼叫 router.prefetch（vinext 會去重，同一頁只抓一次）。
  // 不掛 touchstart：手機滑動時手指常按在卡片上，掛了等於一路滑一路抓；手機點擊時瀏覽器補發的 mouseenter 還是會先抓，
  // 抓的那一次就是換頁要用的那一次，不會多打。只抓站內的字串網址，錨點、外站、API 不抓
  const href = typeof props.href === "string" ? props.href : "";
  const warm = () => {
    if (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api/")) {
      try {
        // kind: full＝整頁抓好放進換頁快取，點下去直接用（預設 auto 對動態頁只抓骨架，點下去還會再打一次）
        router.prefetch(href.split("#")[0], { kind: "full" } as unknown as Parameters<typeof router.prefetch>[1]);
      } catch {
        /* 預抓失敗不影響點擊 */
      }
    }
  };
  return (
    <NextLink
      prefetch={false}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        onMouseEnter?.(e);
        warm();
      }}
      {...props}
    />
  );
}
