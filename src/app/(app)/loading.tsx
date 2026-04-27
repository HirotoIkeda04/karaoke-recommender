/**
 * (app) 配下のページ遷移中に表示される即時フィードバック。
 * Server Component のレンダリングや fetch が完了するまでこの skeleton/spinner が
 * 表示されることで、ユーザーは「画面が固まった」感を回避できる。
 *
 * 各ページ固有の skeleton を作るとより自然だが、共通の中立的な表示で十分。
 */
export default function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-label="読み込み中"
    >
      <div className="flex flex-col items-center gap-3 text-zinc-500 dark:text-zinc-400">
        <div className="size-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-300" />
        <p className="text-xs">読み込み中…</p>
      </div>
    </div>
  );
}
