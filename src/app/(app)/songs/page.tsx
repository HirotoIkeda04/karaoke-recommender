import { SongCard } from "@/components/song-card";
import { createClient } from "@/lib/supabase/server";
import { karaokeToMidi, midiToKaraoke } from "@/lib/note";
import type { Database } from "@/types/database";

import { SearchForm } from "./search-form";

export const dynamic = "force-dynamic";

type Song = Database["public"]["Tables"]["songs"]["Row"];

interface SongsPageProps {
  searchParams: Promise<{
    q?: string;
    high_max?: string; // カラオケ表記 (例: hiC)
    high_min?: string;
  }>;
}

const PAGE_SIZE = 50;

export default async function SongsPage({ searchParams }: SongsPageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const highMaxNotation = params.high_max ?? "";
  const highMinNotation = params.high_min ?? "";

  const highMax = highMaxNotation ? karaokeToMidi(highMaxNotation) : null;
  const highMin = highMinNotation ? karaokeToMidi(highMinNotation) : null;

  const supabase = await createClient();
  let query = supabase
    .from("songs")
    .select(
      "id,title,artist,release_year,range_low_midi,range_high_midi,falsetto_max_midi,image_url_small,image_url_medium",
    )
    .order("artist", { ascending: true })
    .order("title", { ascending: true })
    .limit(PAGE_SIZE);

  if (q) {
    // ILIKE で title / artist 横断検索 (トライグラム index は migration に未追加のため簡易)
    const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.or(`title.ilike.%${escaped}%,artist.ilike.%${escaped}%`);
  }
  if (highMax !== null) {
    query = query.lte("range_high_midi", highMax);
  }
  if (highMin !== null) {
    query = query.gte("range_high_midi", highMin);
  }

  const { data, error } = await query;
  const songs = (data ?? []) as Song[];

  // 各曲の自分の評価を一括取得 (ID で in 検索)
  const ratingByMSongId = new Map<string, string>();
  if (songs.length > 0) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: evals } = await supabase
        .from("evaluations")
        .select("song_id,rating")
        .eq("user_id", user.id)
        .in("song_id", songs.map((s) => s.id));
      for (const ev of evals ?? []) {
        ratingByMSongId.set(ev.song_id, ev.rating);
      }
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <h1 className="text-lg font-semibold">楽曲を検索</h1>

      <SearchForm
        defaultQuery={q}
        defaultHighMax={highMaxNotation}
        defaultHighMin={highMinNotation}
      />

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error.message}
        </div>
      ) : null}

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        {songs.length} 件{songs.length === PAGE_SIZE ? " (上限まで表示)" : ""}
        {highMax !== null ? ` · 最高音 ≤ ${midiToKaraoke(highMax)}` : ""}
        {highMin !== null ? ` · 最高音 ≥ ${midiToKaraoke(highMin)}` : ""}
      </p>

      {songs.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          該当する曲がありません
        </div>
      ) : (
        <ul className="space-y-2">
          {songs.map((s) => (
            <li key={s.id}>
              <SongCard song={s} rating={ratingByMSongId.get(s.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
