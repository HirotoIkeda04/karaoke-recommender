"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Rating = Database["public"]["Enums"]["rating_type"];

export interface RateSongInput {
  songId: string;
  rating: Rating;
}

export interface RateSongResult {
  ok: boolean;
  error?: string;
}

/**
 * 曲を評価する。同じ (user_id, song_id) で再評価したら上書き。
 */
export async function rateSong(input: RateSongInput): Promise<RateSongResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "認証が必要です" };
  }

  const { error } = await supabase.from("evaluations").upsert(
    {
      user_id: user.id,
      song_id: input.songId,
      rating: input.rating,
    },
    { onConflict: "user_id,song_id" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  revalidatePath("/library");
  revalidatePath(`/songs/${input.songId}`);
  return { ok: true };
}

/**
 * 評価を取り消す (DELETE)。
 */
export async function unrateSong(songId: string): Promise<RateSongResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "認証が必要です" };
  }

  const { error } = await supabase
    .from("evaluations")
    .delete()
    .eq("user_id", user.id)
    .eq("song_id", songId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  revalidatePath("/library");
  revalidatePath(`/songs/${songId}`);
  return { ok: true };
}
