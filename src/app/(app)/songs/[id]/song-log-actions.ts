"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type Equipment = "dam" | "joysound";

export interface SongLogInput {
  songId: string;
  loggedAt: string;
  equipment: Equipment | null;
  keyShift: number | null;
  score: number | null;
  body: string;
}

export interface SongLogResult {
  ok: boolean;
  error?: string;
}

function validate(input: SongLogInput): string | null {
  if (!input.loggedAt) return "記録日を入力してください";
  if (Number.isNaN(Date.parse(input.loggedAt))) return "記録日が不正です";

  const hasContent =
    input.equipment !== null ||
    input.keyShift !== null ||
    input.score !== null ||
    input.body.trim().length > 0;
  if (!hasContent) return "機材・キー・点数・本文のいずれかを入力してください";

  if (
    input.keyShift !== null &&
    (!Number.isInteger(input.keyShift) ||
      input.keyShift < -12 ||
      input.keyShift > 12)
  ) {
    return "キー調整は -12 〜 +12 の整数で指定してください";
  }
  if (
    input.score !== null &&
    (!Number.isFinite(input.score) || input.score < 0 || input.score > 100)
  ) {
    return "点数は 0 〜 100 で指定してください";
  }
  return null;
}

export async function createSongLog(input: SongLogInput): Promise<SongLogResult> {
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "認証が必要です" };

  const { error } = await supabase.from("song_logs").insert({
    user_id: user.id,
    song_id: input.songId,
    logged_at: input.loggedAt,
    equipment: input.equipment,
    key_shift: input.keyShift,
    score: input.score,
    body: input.body.trim() ? input.body.trim() : null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/songs/${input.songId}`);
  return { ok: true };
}

export interface UpdateSongLogInput extends SongLogInput {
  id: string;
}

export async function updateSongLog(
  input: UpdateSongLogInput,
): Promise<SongLogResult> {
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "認証が必要です" };

  const { error } = await supabase
    .from("song_logs")
    .update({
      logged_at: input.loggedAt,
      equipment: input.equipment,
      key_shift: input.keyShift,
      score: input.score,
      body: input.body.trim() ? input.body.trim() : null,
    })
    .eq("id", input.id)
    .eq("user_id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/songs/${input.songId}`);
  return { ok: true };
}

export async function deleteSongLog(
  songId: string,
  logId: string,
): Promise<SongLogResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "認証が必要です" };

  const { error } = await supabase
    .from("song_logs")
    .delete()
    .eq("id", logId)
    .eq("user_id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/songs/${songId}`);
  return { ok: true };
}
