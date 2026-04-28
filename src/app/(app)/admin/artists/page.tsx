import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { GENRE_CODES, type GenreCode } from "@/lib/genres";

import { ArtistLabeler, type ArtistRow } from "./labeler";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
type FilterMode = "all" | "unlabeled" | "labeled";

interface SearchParams {
  page?: string;
  filter?: string;
  q?: string;
}

// view の行型 (012 マイグレーションで作成)
// db:types 再生成まで Database 型に乗らないので、as キャストで橋渡しする。
interface ArtistViewRow {
  id: string;
  name: string;
  genres: string[] | null;
  song_count: number;
  is_labeled: boolean;
}

export default async function AdminArtistsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const filter: FilterMode =
    params.filter === "unlabeled" || params.filter === "labeled"
      ? params.filter
      : "all";
  const q = (params.q ?? "").trim();

  const supabase = await createClient();
  // 012 マイグレーションの view は db:types 再生成までクライアント型に乗らないので、
  // この page 内では any 経由でアクセスし、レスポンスを ArtistViewRow に narrow する。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  let query = sb
    .from("artists_with_song_count")
    .select("id, name, genres, song_count, is_labeled", { count: "exact" })
    .order("song_count", { ascending: false })
    .order("name", { ascending: true });

  if (filter === "unlabeled") {
    query = query.eq("is_labeled", false);
  } else if (filter === "labeled") {
    query = query.eq("is_labeled", true);
  }

  if (q.length > 0) {
    query = query.ilike("name", `%${q}%`);
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  query = query.range(from, to);

  const { data, count, error } = (await query) as unknown as {
    data: ArtistViewRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-500">読み込みエラー: {error.message}</p>
      </div>
    );
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const artists: ArtistRow[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    genres: ((row.genres ?? []) as GenreCode[]).filter((g) =>
      (GENRE_CODES as readonly string[]).includes(g),
    ),
    songCount: row.song_count,
  }));

  // 全体進捗 (フィルタ非適用) を別クエリで取得
  const { count: labeledCount } = (await sb
    .from("artists_with_song_count")
    .select("id", { count: "exact", head: true })
    .eq("is_labeled", true)) as { count: number | null };
  const { count: totalArtists } = (await sb
    .from("artists_with_song_count")
    .select("id", { count: "exact", head: true })) as {
    count: number | null;
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold sm:text-2xl">
          アーティスト ジャンルラベリング
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          進捗: {labeledCount ?? 0} / {totalArtists ?? 0} アーティスト
        </p>
      </header>

      <FilterBar currentFilter={filter} q={q} />

      <p className="mb-3 text-sm text-muted-foreground">
        {total} 件中 {from + 1}–{Math.min(from + PAGE_SIZE, total)} 件 (Page{" "}
        {page} / {totalPages})
      </p>

      <ArtistLabeler artists={artists} genreCodes={GENRE_CODES} />

      <Pagination page={page} totalPages={totalPages} filter={filter} q={q} />
    </div>
  );
}

function FilterBar({
  currentFilter,
  q,
}: {
  currentFilter: FilterMode;
  q: string;
}) {
  const filters: { mode: FilterMode; label: string }[] = [
    { mode: "all", label: "すべて" },
    { mode: "unlabeled", label: "未ラベル" },
    { mode: "labeled", label: "ラベル済" },
  ];

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-1.5">
        {filters.map((f) => {
          const sp = new URLSearchParams();
          if (f.mode !== "all") sp.set("filter", f.mode);
          if (q) sp.set("q", q);
          const qs = sp.toString();
          const href = `/admin/artists${qs ? `?${qs}` : ""}`;
          const active = currentFilter === f.mode;
          return (
            <Link
              key={f.mode}
              href={href}
              className={`rounded-full px-3 py-1.5 text-sm transition ${
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground hover:bg-muted/70"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>
      <form className="flex gap-2" action="/admin/artists" method="get">
        {currentFilter !== "all" && (
          <input type="hidden" name="filter" value={currentFilter} />
        )}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="名前で検索"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          検索
        </button>
      </form>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  filter,
  q,
}: {
  page: number;
  totalPages: number;
  filter: FilterMode;
  q: string;
}) {
  if (totalPages <= 1) return null;

  const buildHref = (p: number) => {
    const sp = new URLSearchParams();
    if (p > 1) sp.set("page", String(p));
    if (filter !== "all") sp.set("filter", filter);
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return `/admin/artists${qs ? `?${qs}` : ""}`;
  };

  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;

  return (
    <nav className="mt-6 flex items-center justify-center gap-2 text-sm">
      {prev !== null ? (
        <Link
          href={buildHref(prev)}
          className="rounded-md border border-input px-3 py-1.5 hover:bg-muted"
        >
          ← 前へ
        </Link>
      ) : (
        <span className="rounded-md border border-input px-3 py-1.5 text-muted-foreground opacity-50">
          ← 前へ
        </span>
      )}
      <span className="px-2">
        {page} / {totalPages}
      </span>
      {next !== null ? (
        <Link
          href={buildHref(next)}
          className="rounded-md border border-input px-3 py-1.5 hover:bg-muted"
        >
          次へ →
        </Link>
      ) : (
        <span className="rounded-md border border-input px-3 py-1.5 text-muted-foreground opacity-50">
          次へ →
        </span>
      )}
    </nav>
  );
}
