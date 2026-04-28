import { Music } from "lucide-react";
import Link from "next/link";

interface SpotifyConnection {
  spotify_user_id: string;
  spotify_display_name: string | null;
  connected_at: string;
  last_synced_at: string | null;
}

interface Props {
  connection: SpotifyConnection | null;
  knownSongsCount: number;
  // URL クエリ経由の通知 (callback / sync 後)
  notice: {
    connected: boolean;
    syncedSummary: { matched: number; found: number } | null;
    error: string | null;
    errorDetail: string | null;
  };
}

export function SpotifySection({ connection, knownSongsCount, notice }: Props) {
  return (
    <>
      {/* 通知バナー */}
      {notice.connected ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Spotify 連携が完了しました 🎉 続けて「同期する」を押すと曲データを取り込めます。
        </div>
      ) : null}
      {notice.syncedSummary ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          同期完了 ✅ Spotify から {notice.syncedSummary.found} 曲取得、うち{" "}
          {notice.syncedSummary.matched} 曲があなたのライブラリにマッチしました。
        </div>
      ) : null}
      {notice.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p>Spotify 操作に失敗しました ({notice.error})</p>
          {notice.errorDetail ? (
            <pre className="mt-1 overflow-auto text-[10px] break-words whitespace-pre-wrap text-red-700 dark:text-red-300">
              {notice.errorDetail}
            </pre>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          <Music className="size-4 text-emerald-500" aria-hidden />
          Spotify 連携
        </h2>

        {connection ? (
          <>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              連携済み:{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {connection.spotify_display_name ?? "Spotify ユーザー"}
              </span>
            </p>

            {connection.last_synced_at ? (
              <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
                <p className="text-zinc-700 dark:text-zinc-300">
                  聴いたことある曲: <strong>{knownSongsCount}</strong> 曲
                </p>
                <p className="mt-0.5 text-zinc-500">
                  最終同期:{" "}
                  {new Date(connection.last_synced_at).toLocaleString("ja-JP", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                まだ同期していません。下のボタンを押して曲データを取り込んでください。
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <form action="/api/spotify/sync" method="POST">
                <button
                  type="submit"
                  className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-600 active:bg-emerald-700"
                >
                  Spotify を同期する
                </button>
              </form>
              <form action="/api/spotify/disconnect" method="POST">
                <button
                  type="submit"
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                >
                  連携を解除する
                </button>
              </form>
            </div>
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
    </>
  );
}
