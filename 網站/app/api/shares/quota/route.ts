import { json, requireUser } from "@/lib/server/auth";
import { postQuota } from "@/lib/server/post-quota";

/** 今天還能發幾則、上傳幾張（批次發文用）：{ shares: { used, limit, left }, uploads: {…}, maxPhotos } */
export async function GET(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  return json(await postQuota(s.user.id));
}
