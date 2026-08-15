import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import "server-only";
import { z } from "zod";

import type { GenreCode } from "@/lib/genres";
import type { Database } from "@/types/database";

export type BrowseSong = Pick<
  Database["public"]["Tables"]["songs"]["Row"],
  | "id"
  | "title"
  | "artist"
  | "release_year"
  | "range_low_midi"
  | "range_high_midi"
  | "falsetto_max_midi"
  | "image_url_small"
  | "image_url_medium"
  | "duration_ms"
>;

export interface BrowseSnapshot {
  genreCovers: Partial<Record<GenreCode, string[]>>;
  rankingCovers: string[];
  rankingPreview: Array<{ rank: number; song: BrowseSong }>;
}

const songSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  release_year: z.number().nullable(),
  range_low_midi: z.number().nullable(),
  range_high_midi: z.number().nullable(),
  falsetto_max_midi: z.number().nullable(),
  image_url_small: z.string().nullable(),
  image_url_medium: z.string().nullable(),
  duration_ms: z.number().nullable(),
});

const snapshotSchema = z.object({
  genre_covers: z.record(z.string(), z.array(z.string())),
  ranking_covers: z.array(z.string()),
  ranking_preview: z.array(
    z.object({
      rank: z.number(),
      song: songSchema,
    }),
  ),
});

function createPublicClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

const getCachedBrowseSnapshot = unstable_cache(
  async (): Promise<BrowseSnapshot> => {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("browse_snapshots")
      .select("genre_covers, ranking_covers, ranking_preview")
      .eq("id", "songs")
      .maybeSingle();

    if (error) {
      throw new Error(`browse snapshot query failed: ${error.message}`);
    }
    if (!data) {
      throw new Error("browse snapshot is not initialized");
    }

    const parsed = snapshotSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`invalid browse snapshot: ${parsed.error.message}`);
    }

    return {
      genreCovers: parsed.data.genre_covers as Partial<
        Record<GenreCode, string[]>
      >,
      rankingCovers: parsed.data.ranking_covers,
      rankingPreview: parsed.data.ranking_preview,
    };
  },
  // v4: 週次ランキング更新後も前週のスナップショットが残る事故があったため、
  //     旧キャッシュを破棄する。
  ["songs-browse-snapshot-v4"],
  {
    // 参照先は browse_snapshots の1行 SELECT だけなので TTL を長く取る旨味が
    // 薄い。逆に 1 時間だと refresh:browse-snapshot 後も最大 1 時間だけ古い
    // カルーセルが出続けるため、更新がその日のうちに見える 60 秒にする。
    revalidate: 60,
    tags: ["songs-browse-snapshot"],
  },
);

export async function getBrowseSnapshot(): Promise<BrowseSnapshot> {
  return getCachedBrowseSnapshot();
}
