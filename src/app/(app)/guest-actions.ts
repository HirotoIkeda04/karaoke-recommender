"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Rating = Database["public"]["Enums"]["rating_type"];

export interface GuestRatingInput {
  songId: string;
  rating: Rating;
  updatedAt: string;
}

export interface ImportGuestRatingsResult {
  ok: boolean;
  imported?: number;
  error?: string;
}

const RATINGS: ReadonlySet<string> = new Set([
  "easy",
  "medium",
  "hard",
  "practicing",
  "skip",
]);

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * ゲスト公開曲は 70 曲なので、まともな呼び出しがこれを超えることはない。
 * 壊れた/悪意ある入力で巨大な insert を投げさせないための上限。
 */
const MAX_ROWS = 200;

/**
 * ログイン直後に、ゲスト中 (未ログイン) の評価を evaluations へ移す。
 *
 * 衝突時は **DB 側を残す** (ignoreDuplicates)。既にアカウントを持っている人が
 * 別の端末やログアウト状態で付けた評価より、本人がログインして付けた評価の
 * 方が確かなため。
 *
 * updated_at はゲストが評価した時刻をそのまま入れる。skip の TTL 20 日
 * (get_unrated_songs_v2) がこの列を見ているので、今の時刻で入れ直すと
 * スキップの期限が不当に伸びる。
 */
export async function importGuestRatings(
  rows: GuestRatingInput[],
): Promise<ImportGuestRatingsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "認証が必要です" };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: true, imported: 0 };
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: "引き継げる件数を超えています" };
  }

  const seen = new Set<string>();
  const valid = rows.filter((row) => {
    if (!row || typeof row.songId !== "string" || !UUID_RE.test(row.songId)) {
      return false;
    }
    if (!RATINGS.has(row.rating)) return false;
    if (seen.has(row.songId)) return false;
    seen.add(row.songId);
    return true;
  });

  if (valid.length === 0) return { ok: true, imported: 0 };

  const { error } = await supabase.from("evaluations").upsert(
    valid.map((row) => ({
      user_id: user.id,
      song_id: row.songId,
      rating: row.rating,
      // 端末時計のずれや改竄で未来の時刻が来たら現在時刻に丸める
      updated_at: normalizeTimestamp(row.updatedAt),
    })),
    { onConflict: "user_id,song_id", ignoreDuplicates: true },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  revalidatePath("/library");
  return { ok: true, imported: valid.length };
}

function normalizeTimestamp(value: unknown): string {
  const now = Date.now();
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(parsed) || parsed > now) return new Date(now).toISOString();
  return new Date(parsed).toISOString();
}
