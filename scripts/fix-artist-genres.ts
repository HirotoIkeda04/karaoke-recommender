/**
 * 個別アーティストの genres を手動で上書きする一回限りのスクリプト。
 *
 * bulk-label-artists.ts は LLM 一括ラベリングだが、特定の誤分類を
 * ピンポイントで直したいときはここに対応行を追加して実行する。
 *
 * 実行: pnpm tsx scripts/fix-artist-genres.ts
 */
import { GENRE_CODES, type GenreCode } from "../src/lib/genres";
import { createAdminClient } from "../src/lib/supabase/admin";

interface Override {
  // 名前の表記揺れに依らないよう、name_norm で引きたいところだが、
  // 単純に name 完全一致で十分なケースがほとんど。
  name: string;
  genres: GenreCode[];
  reason: string;
}

const OVERRIDES: Override[] = [
  {
    name: "YOASOBI",
    genres: ["j_pop", "anison"],
    reason: "ボカロ/歌い手出身ではない。J-POP + アニメタイアップ多数",
  },
];

function assertGenres(g: string[]): asserts g is GenreCode[] {
  for (const code of g) {
    if (!(GENRE_CODES as readonly string[]).includes(code)) {
      throw new Error(`unknown genre code: ${code}`);
    }
  }
}

async function main() {
  const sb = createAdminClient();

  for (const ov of OVERRIDES) {
    assertGenres(ov.genres);

    const { data: rows, error: fetchErr } = await sb
      .from("artists")
      .select("id, name, genres")
      .eq("name", ov.name);
    if (fetchErr) throw fetchErr;
    if (!rows || rows.length === 0) {
      console.warn(`[skip] ${ov.name}: artists テーブルに該当行なし`);
      continue;
    }
    if (rows.length > 1) {
      console.warn(
        `[skip] ${ov.name}: ${rows.length} 行ヒット (重複? 手動で確認すること)`,
      );
      continue;
    }
    const before = rows[0].genres ?? [];
    const beforeStr = JSON.stringify(before);
    const afterStr = JSON.stringify(ov.genres);
    if (beforeStr === afterStr) {
      console.log(`[noop] ${ov.name}: 既に ${afterStr}`);
      continue;
    }

    const { error: updErr } = await sb
      .from("artists")
      .update({ genres: ov.genres })
      .eq("id", rows[0].id);
    if (updErr) throw updErr;

    console.log(
      `[ok]   ${ov.name}: ${beforeStr} → ${afterStr}  (${ov.reason})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
