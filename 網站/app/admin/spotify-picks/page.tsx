import { AdminShell } from "@/components/admin-shell";
import { AdminSpotifyPicks } from "@/components/admin-spotify-picks";

export const metadata = { title: "推薦歌曲｜管理後台" };

export default async function SpotifyPicksAdminPage() {
  return (
    <AdminShell current="/admin/spotify-picks">
      <AdminSpotifyPicks />
    </AdminShell>
  );
}
