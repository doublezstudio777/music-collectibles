import { Inbox } from "@/components/inbox";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "私訊" };

export default async function ThreadPage({ params }: Props) {
  const { id } = await params;
  return (
    <main className="wrap page">
      <Inbox id={decodeURIComponent(id)} />
    </main>
  );
}
