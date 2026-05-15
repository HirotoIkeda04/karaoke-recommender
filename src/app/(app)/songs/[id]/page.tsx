import { Play } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { SongCard } from "@/components/song-card";
import { JacketImage } from "@/components/ui/jacket-image";
import { midiToKaraoke } from "@/lib/note";
import { createClient } from "@/lib/supabase/server";

import { RatingControls } from "./rating-controls";
import { SongLogs } from "./song-logs";

const SIMILAR_RANGE_WINDOW = 12;
const SIMILAR_RANGE_LIMIT = 5;
// fame_score は日本語 Wikipedia 累計 pageviews の log10。5.0 ≈ 10 万 view で
// 「かなりの有名曲」の目安。これ未満は同アーティスト曲のみ候補にする。
const SIMILAR_FAME_MIN = 5.0;

export const dynamic = "force-dynamic";

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs == null) return "—";
  const totalSec = Math.round(durationMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

interface SongDetailProps {
  params: Promise<{ id: string }>;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function fetchSimilarSongs(
  supabase: SupabaseServerClient,
  songId: string,
  artistId: string | null,
  lowMidi: number,
  highMidi: number,
) {
  const select =
    "id, title, artist, release_year, range_low_midi, range_high_midi, falsetto_max_midi, image_url_small, image_url_medium, fame_score";

  // 音域ウィンドウ内に絞った上で「同じアーティスト」と「かなりの有名曲」を
  // 別々に引いてマージする。どちらにも当てはまらない無名の他人曲は出さない。
  const rangeFiltered = () =>
    supabase
      .from("songs")
      .select(select)
      .neq("id", songId)
      .gte("range_low_midi", lowMidi - SIMILAR_RANGE_WINDOW)
      .lte("range_low_midi", lowMidi + SIMILAR_RANGE_WINDOW)
      .gte("range_high_midi", highMidi - SIMILAR_RANGE_WINDOW)
      .lte("range_high_midi", highMidi + SIMILAR_RANGE_WINDOW);

  const [sameArtistRes, famousRes] = await Promise.all([
    artistId
      ? rangeFiltered().eq("artist_id", artistId).limit(100)
      : Promise.resolve({ data: [] }),
    rangeFiltered().gte("fame_score", SIMILAR_FAME_MIN).limit(100),
  ]);

  type Row = NonNullable<typeof famousRes.data>[number];
  const merged = new Map<string, Row>();
  for (const r of sameArtistRes.data ?? []) merged.set(r.id, r);
  for (const r of famousRes.data ?? []) merged.set(r.id, r);

  return Array.from(merged.values())
    .map((song) => ({
      song,
      distance:
        Math.abs((song.range_low_midi ?? lowMidi) - lowMidi) +
        Math.abs((song.range_high_midi ?? highMidi) - highMidi),
    }))
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return (b.song.fame_score ?? -Infinity) - (a.song.fame_score ?? -Infinity);
    })
    .slice(0, SIMILAR_RANGE_LIMIT)
    .map(({ song }) => song);
}

export default async function SongDetailPage({ params }: SongDetailProps) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [songRes, evalRes, logsRes] = await Promise.all([
    supabase.from("songs").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("evaluations")
      .select("rating")
      .eq("user_id", user.id)
      .eq("song_id", id)
      .maybeSingle(),
    supabase
      .from("song_logs")
      .select("id, logged_at, equipment, key_shift, score, body")
      .eq("user_id", user.id)
      .eq("song_id", id)
      .order("logged_at", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (songRes.error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="text-sm text-red-600">{songRes.error.message}</p>
      </div>
    );
  }
  if (!songRes.data) notFound();

  const song = songRes.data;
  const evaluation = evalRes.data ?? null;
  const logs = logsRes.data ?? [];
  const image = song.image_url_large ?? song.image_url_medium;

  const similarSongs =
    song.range_low_midi != null && song.range_high_midi != null
      ? await fetchSimilarSongs(
          supabase,
          song.id,
          song.artist_id,
          song.range_low_midi,
          song.range_high_midi,
        )
      : [];

  return (
    <div className="relative">
      {image ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] overflow-hidden"
        >
          <div
            className="absolute inset-0 scale-125 bg-cover bg-center"
            style={{
              backgroundImage: `url(${image})`,
              filter: "blur(64px) saturate(1.3)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background via-30% to-background to-55%" />
        </div>
      ) : null}
      <div className="relative mx-auto max-w-md space-y-5 px-4 py-4">
        <div className="space-y-2">
          <div className="relative">
            <BackButton
              fallbackHref="/songs"
              className="absolute left-0 -top-2 z-10 ml-0!"
            />
            <div className="relative mx-auto mt-2 aspect-square w-3/5 max-w-[14rem] overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800">
              {image ? (
                <JacketImage
                  src={image}
                  alt={`${song.title} のジャケット`}
                  fill
                  sizes="14rem"
                  priority
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-5xl text-zinc-400">
                  ♪
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 text-center">
            <h1 className="truncate text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {song.title}
            </h1>
            <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
              {song.artist_id ? (
                <Link
                  href={`/artists/${song.artist_id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {song.artist}
                </Link>
              ) : (
                song.artist
              )}
              {song.release_year ? ` · ${song.release_year}` : ""}
            </p>
          </div>
        </div>

      <div className="flex items-center justify-center gap-3">
        <RatingControls
          songId={song.id}
          initialRating={evaluation?.rating ?? null}
        />
        {song.spotify_track_id ? (
          <Link
            href={`https://open.spotify.com/track/${song.spotify_track_id}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Spotify で聴く"
            className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-[#1DB954] bg-transparent text-[#1DB954] transition hover:scale-105 hover:bg-[#1DB954]/10"
          >
            <Play className="ml-0.5 size-4 fill-current" aria-hidden />
          </Link>
        ) : null}
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          楽曲情報
        </h2>
        <dl className="mx-4 divide-y divide-zinc-200 rounded-xl bg-zinc-100 px-6 text-sm dark:divide-zinc-700/60 dark:bg-zinc-800/60">
          <div className="flex items-baseline py-3">
            <dt className="w-20 shrink-0 text-zinc-600 dark:text-zinc-400">地声</dt>
            <dd className="font-mono">
              {song.range_low_midi == null && song.range_high_midi == null
                ? "—"
                : `${midiToKaraoke(song.range_low_midi)} — ${midiToKaraoke(song.range_high_midi)}`}
            </dd>
          </div>
          <div className="flex items-baseline py-3">
            <dt className="w-20 shrink-0 text-zinc-600 dark:text-zinc-400">裏声</dt>
            <dd className="font-mono">{midiToKaraoke(song.falsetto_max_midi)}</dd>
          </div>
          <div className="flex items-baseline py-3">
            <dt className="w-20 shrink-0 text-zinc-600 dark:text-zinc-400">長さ</dt>
            <dd className="font-mono">{formatDuration(song.duration_ms)}</dd>
          </div>
        </dl>
      </section>

      {similarSongs.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            似た音域の楽曲
          </h2>
          <ul className="space-y-1">
            {similarSongs.map((s) => (
              <li key={s.id}>
                <SongCard song={s} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SongLogs songId={song.id} initialLogs={logs} />
      </div>
    </div>
  );
}
