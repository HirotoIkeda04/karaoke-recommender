// ============================================================================
// 重複アーティストのマージ 第 3 弾 (2026-08-24)
// ============================================================================
// 第 1 弾 / 第 2 弾は「調査で見つけた組」を UUID でベタ書きしていたが、
// 今回は検出そのものをスクリプトに持たせて、何度でも回せるようにする。
//
// 検出条件は migrations/061 に合わせて「新しい normalize_artist_name で
// name_norm が衝突する組」。061 は artists.name_norm (UNIQUE) を全件再計算
// するので、この衝突が残っていると UNIQUE 違反で適用できない。
// つまり本スクリプトは **061 を適用可能にするための前処理** でもある。
//
// name_search (060 のカナ折り畳み検索キー) の衝突も併せて表示するが、
// そちらは「ヨシキ / ヨシキー」のような別アーティストも巻き込む緩いキーなので
// 自動マージの対象にはせず、目視確認用に出すだけにしてある。
//
// 2026-08-24 時点の検出結果 (7 組、いずれも区切り文字違いのみ):
//   藤山一郎･奈良光枝 / 藤山一郎/奈良光枝
//   五木ひろし･木の実ナナ / 五木ひろし/木の実ナナ
//   石原裕次郎･牧村旬子 / 石原裕次郎/牧村旬子
//   里見浩太朗・横内正 / 里見浩太朗/横内正
//   浜圭介･桂銀淑 / 浜圭介/桂銀淑
//   藤谷美和子・大内義昭 / 藤谷美和子/大内義昭
//   L'Arc-en-Ciel / L'Arc～en～Ciel
//
// 使い方:
//   pnpm merge:dup-artists-3            # 検出のみ (dry-run)
//   pnpm merge:dup-artists-3 --apply    # 実際に統合する
// ============================================================================

import { createAdminClient } from "../src/lib/supabase/admin";

import { mergeArtists } from "./lib/merge-artists";
import { normalizeArtistName } from "./lib/normalize-artist-name";

const APPLY = process.argv.slice(2).includes("--apply");

interface ArtistRow {
  id: string;
  name: string;
  name_norm: string;
  name_search: string | null;
  created_at: string;
  song_count: number;
}

async function fetchArtists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
): Promise<ArtistRow[]> {
  const rows: ArtistRow[] = [];
  const PAGE = 1000; // Supabase の 1 リクエスト上限
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("artists_with_song_count")
      .select("id, name, name_norm, name_search, created_at, song_count")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as ArtistRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

function groupBy(rows: ArtistRow[], key: (a: ArtistRow) => string | null) {
  const groups = new Map<string, ArtistRow[]>();
  for (const a of rows) {
    const k = key(a);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }
  return [...groups.entries()].filter(([, v]) => v.length > 1);
}

/** 勝者: 曲数が多い方 → 同数なら作成が古い方 */
function pickWinner(group: ArtistRow[]): ArtistRow[] {
  return [...group].sort((a, b) => {
    if (a.song_count !== b.song_count) return b.song_count - a.song_count;
    return a.created_at.localeCompare(b.created_at);
  });
}

async function main() {
  console.log(`merge-dup-artists-3 (${APPLY ? "APPLY" : "DRY-RUN"})`);
  const sb = createAdminClient();
  const artists = await fetchArtists(sb);
  console.log(`artists: ${artists.length} 行\n`);

  // --- 自動マージ対象: 061 の normalize_artist_name で衝突する組 ---
  const collisions = groupBy(artists, (a) => normalizeArtistName(a.name));
  console.log(`061 の name_norm で衝突: ${collisions.length} 組`);

  // --- 参考表示: name_search だけで衝突する組 (別アーティストも混ざるので手動判断) ---
  const normKeys = new Set(collisions.map(([k]) => k));
  const searchOnly = groupBy(artists, (a) => a.name_search).filter(
    ([, g]) => !normKeys.has(normalizeArtistName(g[0].name)),
  );
  if (searchOnly.length > 0) {
    console.log(
      `\n--- name_search のみ衝突 (自動マージしない / 要目視): ${searchOnly.length} 組 ---`,
    );
    for (const [k, g] of searchOnly) {
      console.log(
        `  [${k}] ${g.map((a) => `"${a.name}"(songs=${a.song_count}, ${a.id})`).join(" / ")}`,
      );
    }
  }

  if (collisions.length === 0) {
    console.log("\nマージ対象なし。");
    return;
  }

  for (const [key, group] of collisions) {
    const [winner, ...losers] = pickWinner(group);
    console.log(`\n===== [${key}]`);
    console.log(
      `  winner: "${winner.name}" (songs=${winner.song_count}, ${winner.id})`,
    );
    for (const l of losers) {
      console.log(`  loser : "${l.name}" (songs=${l.song_count}, ${l.id})`);
    }
    await mergeArtists(
      sb,
      winner.id,
      losers.map((l) => l.id),
      { dryRun: !APPLY },
    );
  }

  console.log(
    APPLY
      ? "\nAll merges complete. 続けて migrations/061 を SQL エディタで適用すること。"
      : "\nDRY-RUN 完了。実行するには --apply を付ける。",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
