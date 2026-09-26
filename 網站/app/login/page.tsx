import { LoginPage } from "@/components/login-page";

export const metadata = { title: "登入" };

type Props = { searchParams: Promise<{ next?: string; mode?: string }> };

export default async function Page({ searchParams }: Props) {
  const { next, mode } = await searchParams;
  return (
    <main className="wrap page page-auth">
      <LoginPage next={next ?? null} register={mode === "register"} />
    </main>
  );
}
