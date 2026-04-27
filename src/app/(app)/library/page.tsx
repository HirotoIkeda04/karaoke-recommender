import { Check, Dumbbell, Minus, X } from "lucide-react";
import Link from "next/link";

import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { SortableList, type EvaluationRow } from "./sortable-list";

export const dynamic = "force-dynamic";

type Rating = Database["public"]["Enums"]["rating_type"];

const TABS: ReadonlyArray<{ value: Rating; label: string; Icon: typeof X }> = [
  { value: "easy", label: "得意", Icon: Check },
  { value: "practicing", label: "練習中", Icon: Dumbbell },
  { value: "medium", label: "普通", Icon: Minus },
  { value: "hard", label: "苦手", Icon: X },
];

interface LibraryPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const params = await searchParams;
  const activeTab = (params.tab ?? "easy") as Rating;

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return null; // middleware で防がれる想定
  }

  // 全タブ件数を一発で取る
  const { data: counts } = await supabase
    .from("evaluations")
    .select("rating", { count: "exact" })
    .eq("user_id", userId);

  const tabCounts: Record<Rating, number> = {
    easy: 0,
    medium: 0,
    hard: 0,
    practicing: 0,
  };
  for (const row of counts ?? []) {
    tabCounts[row.rating as Rating] += 1;
  }

  // active タブの曲を取得
  // SortableList でクライアント側ソートするため LIMIT を撤廃
  // (1 ユーザーの 1 タブに数千件入るのは現実的でないので問題なし)
  const [evalQueryRes, knownIds] = await Promise.all([
    supabase
      .from("evaluations")
      .select(
        `
      rating,
      updated_at,
      song:songs (
        id, title, artist, release_year,
        range_low_midi, range_high_midi, falsetto_max_midi,
        image_url_small, image_url_medium
      )
    `,
      )
      .eq("user_id", userId)
      .eq("rating", activeTab)
      .order("updated_at", { ascending: false }),
    getUserKnownSongIds(),
  ]);
  const { data: rows, error } = evalQueryRes;

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {TABS.map((tab) => {
          const active = tab.value === activeTab;
          return (
            <Link
              key={tab.value}
              href={`/library?tab=${tab.value}`}
              className={`flex flex-col items-center gap-0.5 rounded-md px-2 py-2 text-xs ${
                active
                  ? "bg-white shadow-sm dark:bg-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <tab.Icon className="size-3.5" aria-hidden />
                {tab.label}
              </span>
              <span className="text-[10px] tabular-nums text-zinc-500">
                {tabCounts[tab.value]}
              </span>
            </Link>
          );
        })}
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error.message}
        </div>
      ) : null}

      {(rows ?? []).length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          このカテゴリの曲はまだありません
        </div>
      ) : (
        <SortableList
          evaluations={(rows ?? []) as unknown as EvaluationRow[]}
          knownSongIds={Array.from(knownIds)}
        />
      )}
    </div>
  );
}
