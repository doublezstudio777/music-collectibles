"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, Disc3 } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/", label: "發現" },
  { href: "/work", label: "作品" },
  { href: "/me", label: "我的收藏" },
];

export function SiteHeader() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="音藏，回到首頁">
        <span className="brand-mark">
          <Disc3 aria-hidden="true" />
        </span>
        <span>音藏</span>
      </Link>
      <nav className="main-nav" aria-label="主要導覽">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(item.href) ? "is-active" : undefined}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <Button className="rounded-full" variant="outline">
        <Camera aria-hidden="true" />
        分享收藏
      </Button>
    </header>
  );
}
