import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArtistRow, type ArtistRowData } from "@/components/artist-row";
import { GENRE_LABELS, isGenreCode } from "@/lib/genres";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface GenrePageProps {
  params: Promise<{ code: string }>;
}

// ジャンルあたりのアーティスト件数上限。
// 一番多い J-POP でも数千程度なので、まずは 500 件で頭打ち。
// 仮想化を入れるなら緩められるが、今は素直なリストでも十分軽い。
const ARTIST_LIMIT = 500;

export default async function GenreArtistsPage({ params }: GenrePageProps) {
  const { code } = await params;
  if (!isGenreCode(code)) notFound();

  const supabase = await createClient();

  // artists_with_song_count: id, name, genres, song_count
  // 「曲数 0 のアーティスト」は実質ゴミなのでフィルタ
  const { data: rows, error } = await supabase
    .from("artists_with_song_count")
    .select("id, name, song_count")
    .contains("genres", [code])
    .gt("song_count", 0)
    .order("song_count", { ascending: false })
    .order("name", { ascending: true })
    .limit(ARTIST_LIMIT);

  // 各アーティストのジャケット画像 (検索結果と同様、最新リリース 1 枚)。
  // RPC を作るほどでもないので、id 配列で一括引いてから client 側で合流する。
  const ids = (rows ?? []).map((r) => r.id).filter((id): id is string => !!id);
  const imageMap = new Map<string, string | null>();
  if (ids.length > 0) {
    // songs を release_year desc で order すると重いので、
    // 必要列だけ・artist_id in (...) でまとめて取り、JS 側で先頭を採用する
    const { data: songRows } = await supabase
      .from("songs")
      .select("artist_id, image_url_small, image_url_medium, release_year")
      .in("artist_id", ids)
      .or("image_url_small.not.is.null,image_url_medium.not.is.null")
      .order("release_year", { ascending: false, nullsFirst: false });
    for (const s of songRows ?? []) {
      if (!s.artist_id) continue;
      if (imageMap.has(s.artist_id)) continue;
      imageMap.set(
        s.artist_id,
        s.image_url_small ?? s.image_url_medium ?? null,
      );
    }
  }

  const artists: ArtistRowData[] = (rows ?? [])
    .filter((r): r is { id: string; name: string; song_count: number | null } =>
      Boolean(r.id && r.name),
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      song_count: r.song_count,
      image_url: imageMap.get(r.id) ?? null,
    }));

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <Link
          href="/songs"
          aria-label="検索に戻る"
          className="-ml-2 grid size-9 place-items-center rounded-full text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
          {GENRE_LABELS[code]}
        </h1>
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          {artists.length.toLocaleString()} 組
          {artists.length === ARTIST_LIMIT ? "+" : ""}
        </span>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error.message}
        </div>
      ) : artists.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          このジャンルのアーティストはまだ登録されていません
        </p>
      ) : (
        <ul>
          {artists.map((a) => (
            <li key={a.id}>
              <ArtistRow artist={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
