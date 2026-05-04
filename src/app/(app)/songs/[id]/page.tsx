import Link from "next/link";
import { notFound } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { buttonVariants } from "@/components/ui/button";
import { JacketImage } from "@/components/ui/jacket-image";
import { midiToKaraoke } from "@/lib/note";
import { createClient } from "@/lib/supabase/server";

import { RatingControls } from "./rating-controls";
import { SongLogs } from "./song-logs";

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
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background via-30% to-background to-55%" />
        </div>
      ) : null}
      <div className="relative mx-auto max-w-md space-y-5 px-4 py-4">
        <div className="relative">
          <BackButton
            fallbackHref="/songs"
            className="absolute left-0 -top-2 z-10 !ml-0"
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

      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {song.title}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
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

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-zinc-100 p-4 text-sm dark:bg-zinc-800">
        <dt className="text-zinc-600 dark:text-zinc-400">地声 最低</dt>
        <dd className="text-right font-mono">{midiToKaraoke(song.range_low_midi)}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">地声 最高</dt>
        <dd className="text-right font-mono">{midiToKaraoke(song.range_high_midi)}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">裏声 最高</dt>
        <dd className="text-right font-mono">{midiToKaraoke(song.falsetto_max_midi)}</dd>
        <dt className="text-zinc-600 dark:text-zinc-400">曲の長さ</dt>
        <dd className="text-right font-mono">{formatDuration(song.duration_ms)}</dd>
      </dl>

      <RatingControls
        songId={song.id}
        initialRating={evaluation?.rating ?? null}
      />

      <SongLogs songId={song.id} initialLogs={logs} />

      {song.spotify_track_id ? (
        <Link
          href={`https://open.spotify.com/track/${song.spotify_track_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "lg" }) + " w-full"}
        >
          Spotify で聴く
        </Link>
      ) : null}
      </div>
    </div>
  );
}
