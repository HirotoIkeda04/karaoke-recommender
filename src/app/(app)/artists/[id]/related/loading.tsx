export default function Loading() {
  return (
    <div
      className="mx-auto max-w-md animate-pulse px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      <header className="mb-6 flex items-start gap-2">
        <div className="size-9 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="space-y-2 pt-1">
          <div className="h-5 w-36 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-52 rounded bg-zinc-100 dark:bg-zinc-900" />
        </div>
      </header>
      <div className="space-y-8">
        {[0, 1, 2].map((group) => (
          <section key={group}>
            <div className="mb-3 flex items-center gap-3">
              <div className="size-11 rounded-full bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="space-y-1">
              {[0, 1, 2].map((song) => (
                <div key={song} className="flex items-center gap-3 p-2">
                  <div className="size-11 rounded-md bg-zinc-200 dark:bg-zinc-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-3 w-12 rounded bg-zinc-100 dark:bg-zinc-900" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
