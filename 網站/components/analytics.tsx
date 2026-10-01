"use client";

// GA4 載入與 page_view（lib/analytics.ts 的說明）。放在 layout，只在 lemibox.com 載入
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { cleanTitle, cleanUrl, GA_ID, gaEnabled } from "@/lib/analytics";

export function Analytics() {
  const pathname = usePathname();
  const loaded = useRef(false);
  useEffect(() => {
    if (!gaEnabled()) return;
    if (!loaded.current) {
      loaded.current = true;
      window.dataLayer = window.dataLayer || [];
      // gtag 官方寫法：把 arguments 物件推進 dataLayer
      window.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer!.push(arguments);
      };
      window.gtag("js", new Date());
      window.gtag("config", GA_ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
      document.head.appendChild(s);
    }
    // 換頁後標題要等新頁面設好，晚 0.3 秒再送
    const t = setTimeout(() => {
      const { location, path } = cleanUrl(window.location.href);
      const title = cleanTitle(window.location.pathname, document.title);
      // 用 set 蓋掉預設值：GA 自動送的事件（user_engagement、scroll…）也改用清過的網址與標題，不會帶出暱稱或驗證碼
      window.gtag?.("set", { page_location: location, page_path: path, page_title: title });
      window.gtag?.("event", "page_view", { page_location: location, page_path: path, page_title: title });
    }, 300);
    return () => clearTimeout(t);
  }, [pathname]);
  return null;
}
