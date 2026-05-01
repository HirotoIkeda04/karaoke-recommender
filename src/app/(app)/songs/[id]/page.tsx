import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { midiToKaraoke } from "@/lib/note";
import { createClient } from "@/lib/supabase/server";

import { RatingControls } from "./rating-controls";

export const dynamic = "force-dynamic";

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

  const [songRes, evalRes] = await Promise.all([
    supabase.from("songs").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("evaluations")
      .select("rating, memo, key_shift")
      .eq("user_id", user.id)
      .eq("song_id", id)
      .maybeSingle(),
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
  const image = song.image_url_large ?? song.image_url_medium;

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-zinc-200 dark:bg-zinc-800">
        {image ? (
          <Image
            src={image}
            alt={`${song.title} のジャケット`}
            fill
            sizes="(max-width: 28rem) 100vw, 28rem"
            priority
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl text-zinc-400">
            ♪
          </div>
        )}
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
      </dl>

      <RatingControls
        songId={song.id}
        initialRating={evaluation?.rating ?? null}
        initialMemo={evaluation?.memo ?? ""}
      />

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
  );
}
