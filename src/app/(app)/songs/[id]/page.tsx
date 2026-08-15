import { Play, ScrollText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { buttonVariants } from "@/components/ui/button";
import { SongCard } from "@/components/song-card";
import { JacketImage } from "@/components/ui/jacket-image";
import { SongFloatingHeader } from "@/components/song-floating-header";
import { findGuestSimilarSongs, toSong } from "@/lib/guest-songs";
import { getGuestSong, getGuestSongs } from "@/lib/guest-songs.server";
import { midiToKaraoke, noteChipColor } from "@/lib/note";
import {
  SIMILAR_RANGE_LIMIT,
  SIMILAR_RANGE_WINDOW,
  type SimilarSong,
  fetchSimilarSongs,
} from "@/lib/similar-songs";
import { fetchAllPaginated } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";


import { RatingControls } from "./rating-controls";
import { SongLogs } from "./song-logs";

export const dynamic = "force-dynamic";

/** 似た音域の一覧の先頭に、評価済みの曲を最大いくつ差し込むか */
const RATED_SIMILAR_LIMIT = 2;

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs == null) return "—";
  const totalSec = Math.round(durationMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** 音域ノートを高さ由来の色で表示する。null は無印 "—"。 */
function ColoredNote({ midi }: { midi: number | null | undefined }) {
  if (midi == null) return <>—</>;
  return (
    <span style={{ color: noteChipColor(midi).background }}>
      {midiToKaraoke(midi)}
    </span>
  );
}

/**
 * ゲストが公開 70 曲の外の曲を開いた時 (共有リンク・ブックマーク等)。
 * 曲名すら出せないので、ログインすれば見られることだけ伝える。
 */
function GuestSongLocked({ songId }: { songId: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        この曲を見るにはログインが必要です
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        ログインしていない間は、お試しの曲だけを表示しています。
      </p>
      <Link
        href={`/login?next=${encodeURIComponent(`/songs/${songId}`)}`}
        className={buttonVariants({ size: "lg" })}
      >
        ログインする
      </Link>
      <Link
        href="/songs"
        className="text-xs text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
      >
        お試しの曲を見る
      </Link>
    </div>
  );
}

interface SongDetailProps {
  params: Promise<{ id: string }>;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function fetchRatedSimilarSongs(
  supabase: SupabaseServerClient,
  userId: string,
  songId: string,
  lowMidi: number,
  highMidi: number,
) {
  // Supabase の 1000 行上限を range() のページ送りで越えて全評価を取得する
  // (1000 件超のユーザーで古い評価が欠落し似た曲推薦の精度が落ちる不具合を防ぐ)。
  const { data } = await fetchAllPaginated((from, to) =>
    supabase
      .from("evaluations")
      .select(
        `
      rating,
      song:songs (
        id, title, artist, release_year,
        range_low_midi, range_high_midi, falsetto_max_midi,
        image_url_small, image_url_medium, duration_ms
      )
    `,
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .range(from, to),
  );

  return data
    .flatMap((row) => {
      const song = row.song;
      if (
        !song ||
        song.id === songId ||
        song.range_low_midi == null ||
        song.range_high_midi == null
      ) {
        return [];
      }
      const distance =
        Math.abs(song.range_low_midi - lowMidi) +
        Math.abs(song.range_high_midi - highMidi);
      if (distance > SIMILAR_RANGE_WINDOW * 2) return [];
      return [{ song, rating: row.rating, distance }];
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, RATED_SIMILAR_LIMIT);
}

export default async function SongDetailPage({ params }: SongDetailProps) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ゲスト (未ログイン) はカタログ全体を引けないので、公開 70 曲の中の
  // 曲だけ表示する。範囲外はログイン導線を出す (共有リンクを踏んだ時など)。
  const guestRecord = user ? null : getGuestSong(id);
  if (!user && !guestRecord) return <GuestSongLocked songId={id} />;

  const [songRes, evalRes, logsRes] = user
    ? await Promise.all([
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
      ])
    : [
        // ゲストの評価は localStorage にあるので RatingControls が自分で読む
        { data: toSong(guestRecord!), error: null },
        { data: null },
        { data: [] },
      ];

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

  const hasRange =
    song.range_low_midi != null && song.range_high_midi != null;

  const [recommended, ratedSimilarSongs] =
    user && hasRange
      ? await Promise.all([
          fetchSimilarSongs(
            supabase,
            song.id,
            song.artist_id,
            song.genres,
            song.range_low_midi!,
            song.range_high_midi!,
          ),
          fetchRatedSimilarSongs(
            supabase,
            user.id,
            song.id,
            song.range_low_midi!,
            song.range_high_midi!,
          ),
        ])
      : [
          // ゲストは 70 曲の中から音域が近いものを出す
          guestRecord
            ? findGuestSimilarSongs(
                getGuestSongs(),
                guestRecord,
                SIMILAR_RANGE_LIMIT,
              ).map(toSong)
            : [],
          [],
        ];

  // 評価済みの似た音域曲を先頭に置き、残りを一般推薦で埋める (重複は除外)
  const similarSongs: { id: string; song: SimilarSong; rating?: string }[] = [];
  for (const { song: s, rating } of ratedSimilarSongs) {
    similarSongs.push({ id: s.id, song: s, rating });
  }
  for (const s of recommended) {
    if (similarSongs.length >= SIMILAR_RANGE_LIMIT) break;
    if (similarSongs.some((x) => x.id === s.id)) continue;
    similarSongs.push({ id: s.id, song: s });
  }

  return (
    <div className="relative isolate">
      {image ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[84rem] overflow-hidden"
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
      <div className="relative mx-auto max-w-md space-y-5 px-4 pb-4 pt-[var(--song-detail-top-padding,1rem)]">
        <SongFloatingHeader
          title={song.title}
          artist={song.artist}
          artistId={song.artist_id}
          releaseYear={song.release_year}
          image={image}
        />
        <div className="relative mx-5 flex items-center gap-4 pr-[var(--song-detail-trailing-padding,0rem)] pl-[var(--song-detail-leading-padding,2.5rem)]">
          <BackButton
            fallbackHref="/songs"
            className="absolute left-0 -top-2 z-10 ml-0!"
          />
          <div className="relative aspect-square w-[28%] max-w-[6.5rem] shrink-0 overflow-hidden rounded-xs bg-zinc-200 dark:bg-zinc-800">
            {image ? (
              <JacketImage
                src={image}
                alt={`${song.title} のジャケット`}
                fill
                sizes="6.5rem"
                priority
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-5xl text-zinc-400">
                ♪
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <h1 className="line-clamp-2 text-2xl leading-tight font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {song.title}
            </h1>
            <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
              {/* アーティストページはログイン必須なので、ゲストには
                  リンクにせず名前だけ出す (開けない導線を作らない) */}
              {song.artist_id && user ? (
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

        <div
          aria-label="楽曲の操作"
          className="-mr-4 ml-4 flex snap-x snap-mandatory gap-2 overflow-x-auto pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="shrink-0 snap-start">
            <RatingControls
              songId={song.id}
              initialRating={evaluation?.rating ?? null}
              compact
            />
          </div>
          {song.spotify_track_id ? (
            <Link
              href={`https://open.spotify.com/track/${song.spotify_track_id}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Spotify で再生する"
              className="inline-flex h-9 shrink-0 snap-start items-center justify-center gap-2 rounded-full bg-zinc-100/80 px-4 text-xs font-medium text-zinc-700 backdrop-blur-sm transition hover:bg-zinc-200/85 active:bg-zinc-200/85 dark:bg-zinc-800/75 dark:text-zinc-200 dark:hover:bg-zinc-700/80 dark:active:bg-zinc-700/80"
            >
              <Play className="size-3.5 fill-current" aria-hidden />
              <span>再生する</span>
            </Link>
          ) : null}
          <Link
            href={`https://www.uta-net.com/search/?target=song&type=in&Keyword=${encodeURIComponent(song.title)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="歌詞ネットで歌詞を見る"
            className="inline-flex h-9 shrink-0 snap-start items-center justify-center gap-2 rounded-full bg-zinc-100/80 px-4 text-xs font-medium text-zinc-700 backdrop-blur-sm transition hover:bg-zinc-200/85 active:bg-zinc-200/85 dark:bg-zinc-800/75 dark:text-zinc-200 dark:hover:bg-zinc-700/80 dark:active:bg-zinc-700/80"
          >
            <ScrollText className="size-4" aria-hidden />
            <span>歌詞を見る</span>
          </Link>
        </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          楽曲情報
        </h2>
        <dl className="mx-4 divide-y divide-zinc-200 rounded-xl bg-zinc-100 px-6 text-sm dark:divide-zinc-700/60 dark:bg-zinc-800/60">
          <div className="flex items-baseline py-3">
            <dt className="w-20 shrink-0 text-zinc-600 dark:text-zinc-400">地声</dt>
            <dd className="font-mono">
              {song.range_low_midi == null && song.range_high_midi == null ? (
                "—"
              ) : (
                <>
                  <ColoredNote midi={song.range_low_midi} />
                  {" — "}
                  <ColoredNote midi={song.range_high_midi} />
                </>
              )}
            </dd>
          </div>
          <div className="flex items-baseline py-3">
            <dt className="w-20 shrink-0 text-zinc-600 dark:text-zinc-400">裏声</dt>
            <dd className="font-mono">
              <ColoredNote midi={song.falsetto_max_midi} />
            </dd>
          </div>
          <div className="flex items-baseline py-3">
            <dt className="w-20 shrink-0 text-zinc-600 dark:text-zinc-400">長さ</dt>
            <dd className="font-mono">{formatDuration(song.duration_ms)}</dd>
          </div>
        </dl>
      </section>

      {/* カラオケの記録はアカウントに紐づくので、ゲストには出さない */}
      {user ? <SongLogs songId={song.id} initialLogs={logs} /> : null}

      {similarSongs.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            似た音域の楽曲
          </h2>
          <ul className="space-y-1">
            {similarSongs.map(({ id: sid, song: s, rating }) => (
              <li key={sid}>
                <SongCard song={s} rating={rating} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      </div>
    </div>
  );
}
