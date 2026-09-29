import { FeedbackForm } from "@/components/feedback-form";
import { isFeedbackKind } from "@/lib/feedback";

export const metadata = { title: "意見回饋" };

type Props = { searchParams?: Promise<{ type?: string }> };

export default async function FeedbackPage({ searchParams }: Props) {
  const t = (await searchParams)?.type;
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">意見回饋</h1>
      <FeedbackForm key={t ?? ""} initialKind={isFeedbackKind(t) ? t : null} />
    </main>
  );
}
