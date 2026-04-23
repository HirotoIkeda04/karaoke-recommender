import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TestDbPage() {
  const supabase = await createClient();
  const { data: songs, error } = await supabase
    .from("songs")
    .select("id, title, artist, release_year, range_low_midi, range_high_midi")
    .limit(5);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-bold text-red-600">DB 接続エラー</h1>
        <pre className="mt-4 rounded bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          {error.message}
        </pre>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">songs テーブル疎通テスト</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        取得件数: {songs?.length ?? 0}
      </p>

      {songs && songs.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {songs.map((song) => (
            <li
              key={song.id}
              className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="font-medium">{song.title}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {song.artist}
                {song.release_year ? ` / ${song.release_year}` : ""}
              </div>
              {(song.range_low_midi !== null ||
                song.range_high_midi !== null) && (
                <div className="mt-1 text-xs text-zinc-500">
                  MIDI: {song.range_low_midi ?? "?"} 〜{" "}
                  {song.range_high_midi ?? "?"}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          まだ楽曲マスタは空です(Step 4 の seed 投入で登録されます)。
          テーブルへのアクセス自体は成功しています。
        </p>
      )}
    </main>
  );
}
