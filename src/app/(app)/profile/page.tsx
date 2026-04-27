import { Music } from "lucide-react";
import Link from "next/link";

import { midiToKaraoke } from "@/lib/note";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

interface ProfilePageProps {
  searchParams: Promise<{
    spotify_connected?: string;
    spotify_error?: string;
  }>;
}

type Rating = Database["public"]["Enums"]["rating_type"];

const MIN_FOR_ESTIMATE = 5; // この件数以上で音域推定を表示

const RATING_META: Record<Rating, { label: string; color: string }> = {
  easy: { label: "得意", color: "bg-emerald-500" },
  practicing: { label: "練習中", color: "bg-purple-500" },
  medium: { label: "普通", color: "bg-yellow-500" },
  hard: { label: "苦手", color: "bg-red-500" },
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const params = await searchParams;
  const spotifyConnected = params.spotify_connected === "true";
  const spotifyError = params.spotify_error ?? null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [estRes, evalsRes, spotifyRes] = await Promise.all([
    supabase
      .from("user_voice_estimate")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("evaluations")
      .select("rating", { count: "exact" })
      .eq("user_id", user.id),
    supabase
      .from("user_spotify_connections")
      .select("spotify_user_id, spotify_display_name, connected_at")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const spotifyConnection = spotifyRes.data ?? null;

  const estimate = estRes.data;
  const counts: Record<Rating, number> = {
    easy: 0, medium: 0, hard: 0, practicing: 0,
  };
  for (const ev of evalsRes.data ?? []) {
    counts[ev.rating as Rating] += 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const showEstimate =
    estimate && (estimate.easy_count ?? 0) >= MIN_FOR_ESTIMATE;

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      {/* Spotify 連携の通知バナー (callback 経由のみ表示) */}
      {spotifyConnected ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Spotify 連携が完了しました 🎉
        </div>
      ) : null}
      {spotifyError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Spotify 連携に失敗しました ({spotifyError})
        </div>
      ) : null}

      <h1 className="text-lg font-semibold">あなたの音域</h1>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          推定音域
        </h2>

        {showEstimate ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-zinc-600 dark:text-zinc-400">快適 (75 percentile)</dt>
            <dd className="text-right font-mono">
              {midiToKaraoke(estimate.comfortable_min_midi)} 〜{" "}
              {midiToKaraoke(estimate.comfortable_max_midi)}
            </dd>
            <dt className="text-zinc-600 dark:text-zinc-400">最大限界</dt>
            <dd className="text-right font-mono">
              {midiToKaraoke(estimate.limit_min_midi)} 〜{" "}
              {midiToKaraoke(estimate.limit_max_midi)}
            </dd>
            <dt className="text-zinc-600 dark:text-zinc-400">裏声 上限</dt>
            <dd className="text-right font-mono">
              {midiToKaraoke(estimate.falsetto_max_midi)}
            </dd>
          </dl>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            「得意」評価が {MIN_FOR_ESTIMATE} 件以上で推定値を表示します
            (現在: {estimate?.easy_count ?? 0} 件)
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          評価統計 (全 {total} 曲)
        </h2>

        {total === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            まだ評価がありません
          </p>
        ) : (
          <ul className="space-y-2">
            {(Object.entries(RATING_META) as [Rating, typeof RATING_META[Rating]][]).map(
              ([rating, meta]) => {
                const count = counts[rating];
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <li key={rating} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span>{meta.label}</span>
                      <span className="tabular-nums text-zinc-500">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={`h-full ${meta.color}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        )}
      </section>

      {/* Spotify 連携セクション */}
      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          <Music className="size-4 text-emerald-500" aria-hidden />
          Spotify 連携
        </h2>

        {spotifyConnection ? (
          <>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              連携済み: {spotifyConnection.spotify_display_name ?? "Spotify ユーザー"}
            </p>
            {/* 連携解除フォーム (POST で /api/spotify/disconnect) */}
            <form action="/api/spotify/disconnect" method="POST">
              <button
                type="submit"
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
              >
                連携を解除する
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              連携すると、あなたが Spotify でよく聴く曲・最近聴いた曲を、評価デッキで「聴いたことある」マークで表示します。
            </p>
            <a
              href="/api/spotify/connect"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 active:bg-emerald-700"
            >
              <Music className="size-4" aria-hidden />
              Spotify を連携する
            </a>
            <p className="text-[11px] text-zinc-500">
              連携前に{" "}
              <Link
                href="/privacy"
                className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                プライバシーポリシー
              </Link>{" "}
              をご確認ください。
            </p>
          </>
        )}
      </section>
    </div>
  );
}
