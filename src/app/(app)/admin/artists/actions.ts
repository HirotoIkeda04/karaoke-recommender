"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin-guard";
import { isGenreCode } from "@/lib/genres";
import { createAdminClient } from "@/lib/supabase/admin";

export interface UpdateArtistGenresResult {
  error: string | null;
}

export async function updateArtistGenres(
  artistId: string,
  genres: string[],
): Promise<UpdateArtistGenresResult> {
  await requireAdmin();

  // 不正値はサイレントに捨てる (UI 側でも正規値しか送らないが念のため)
  const validated = genres.filter(isGenreCode);

  // requireAdmin() でガード済みなので service_role で書き込む。
  // authenticated に UPDATE を GRANT しなくて済む = 多層防御。
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("artists")
    .update({ genres: validated, updated_at: new Date().toISOString() })
    .eq("id", artistId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/artists");
  return { error: null };
}
