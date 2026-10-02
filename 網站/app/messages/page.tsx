import { Inbox } from "@/components/inbox";

export const metadata = { title: "私訊" };

export default function MessagesPage() {
  return (
    <main id="main" className="wrap page">
      <Inbox />
    </main>
  );
}
