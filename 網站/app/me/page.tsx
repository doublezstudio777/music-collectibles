import { redirect } from "next/navigation";
import { CURRENT_USER, userHref } from "@/lib/data";

export default function MePage() {
  redirect(userHref(CURRENT_USER));
}
