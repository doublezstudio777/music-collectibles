import { SettingsForm } from "@/components/settings";

export const metadata = { title: "設定" };

export default function SettingsPage() {
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">設定</h1>
      <SettingsForm />
    </main>
  );
}
