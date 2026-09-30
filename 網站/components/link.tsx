// 站內連結（2026-10-01 CPU 緊急修正）：包 next/link，預設不預取（prefetch={false}）。
//
// 為什麼：vinext 的 <Link> 預設「連結一進畫面就預取」，每個預取都是一次整頁伺服器渲染（RSC）。
// 一頁常有 10～20 個連結（卡片、頁首、頁尾），開一頁就同時打 10～30 個請求給 Worker，
// 整頁快取鍵又含路由狀態（從哪一頁來），大多沒命中，免費方案每請求 CPU 10ms 撐不住，
// 連續超過就被擋成 Error 1102／站內換頁「This page couldn't load」（產出/20261001_CPU超限緊急處理/）。
// 關掉後，點下去才抓那一頁，一次一個請求。真的要預取的連結可以明寫 prefetch 蓋過去。
//
// 全站一律從這裡 import Link，不要直接 import "next/link"（eslint 沒擋，靠這段註解與 README）。
import NextLink from "next/link";
import type { ComponentProps } from "react";

export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
