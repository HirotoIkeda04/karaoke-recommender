"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin-guard";
import { isGenreCode } from "@/lib/genres";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
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
