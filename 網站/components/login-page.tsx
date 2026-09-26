"use client";

// /login 整頁版：直接打網址、/me 沒登入、驗證信連結之後都走這裡。?next= 登入後回去的頁面，?mode=register 直接註冊

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type PanelMode, useAccount } from "@/lib/account";
import { AuthForm } from "@/components/auth-form";

const safeNext = (v: string | null) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/");

export function LoginPage({ next: rawNext, register }: { next: string | null; register: boolean }) {
  const router = useRouter();
  const { status, me } = useAccount();
  const next = safeNext(rawNext);
  const [mode, setMode] = useState<PanelMode>(register ? "register" : "login");

  useEffect(() => {
    if (status === "user" && me) router.replace(next === "/me" ? `/u/${me.handle}` : next);
  }, [status, me, next, router]);

  if (status !== "anon") return null;
  return (
    <div className="auth-page">
      <AuthForm idp="page" mode={mode} setMode={setMode} />
    </div>
  );
}
