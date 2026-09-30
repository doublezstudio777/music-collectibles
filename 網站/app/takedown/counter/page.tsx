import { TakedownCounter } from "@/components/takedown-counter";

export const metadata = { title: "回復通知" };

type Props = { searchParams?: Promise<{ id?: string }> };

export default async function CounterPage({ searchParams }: Props) {
  const id = Number((await searchParams)?.id);
  return (
    <main className="wrap page page-narrow legal">
      <h1 className="page-title">回復通知</h1>
      {Number.isInteger(id) && id > 0 ? <TakedownCounter id={id} /> : <p className="empty">網址少了通知編號</p>}
    </main>
  );
}
