import { Admin } from "@/components/admin";

export const metadata = { title: "管理後台" };

export default function AdminPage() {
  return (
    <main className="wrap page">
      <h1 className="page-title">管理後台</h1>
      <Admin />
    </main>
  );
}
