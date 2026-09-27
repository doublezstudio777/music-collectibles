import { AdminShell } from "@/components/admin-shell";
import { AdminArtistPhotos } from "@/components/admin-artist-photos";

export const metadata = { title: "藝人照片｜管理後台" };

export default async function ArtistPhotosPage() {
  return (
    <AdminShell current="/admin/artist-photos">
      <AdminArtistPhotos />
    </AdminShell>
  );
}
