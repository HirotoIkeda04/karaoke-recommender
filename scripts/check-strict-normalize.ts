// ============================================================================
// artists.name_norm の健全性チェック
// ----------------------------------------------------------------------------
// 元々は migrations/033 で normalize_artist_name を厳格化する前に UNIQUE 衝突が
// 出ないかを確かめる使い捨てスクリプトだったが、061 で同じ検証が再び必要に
// なったので常設のチェックにした。見るのは 2 点:
//
//   1. 衝突   — name を再正規化したとき 2 行以上が同じキーに落ちないか。
//               落ちると name_norm (UNIQUE) の再計算が失敗する。
//               出たら scripts/merge-dup-artists-3.ts で統合する。
//   2. 未同期 — name_norm が normalize_artist_name の出力と一致しているか。
//               ズレている行は SQL 関数を通さず独自 normalize で INSERT された
//               行 = 将来の重複予備軍。
//
// 使い方:
//   pnpm check:strict-normalize
// ============================================================================
import { createAdminClient } from "../src/lib/supabase/admin";

import { normalizeArtistName } from "./lib/normalize-artist-name";

async function main() {
  const supabase = createAdminClient();
  const all: { id: string; name: string; name_norm: string }[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("artists")
      .select("id, name, name_norm")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as { id: string; name: string; name_norm: string }[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Total artists: ${all.length}`);

  const groups = new Map<string, typeof all>();
  for (const a of all) {
    const k = normalizeArtistName(a.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }

  const collisions = [...groups.entries()].filter(([, v]) => v.length > 1);
  console.log(`\n[1] 再正規化での衝突: ${collisions.length} 組`);
  for (const [k, group] of collisions) {
    console.log(`  [${k}]`);
    for (const a of group) console.log(`    - "${a.name}"  (id=${a.id})`);
  }
  if (collisions.length > 0) {
    console.log("  → pnpm merge:dup-artists-3 で統合してから移行すること。");
  }

  const stale = all.filter((a) => a.name_norm !== normalizeArtistName(a.name));
  console.log(`\n[2] name_norm が関数出力と不一致: ${stale.length} 行`);
  for (const a of stale) {
    console.log(
      `  - "${a.name}"  name_norm="${a.name_norm}" → "${normalizeArtistName(a.name)}"  (id=${a.id})`,
    );
  }
  if (stale.length > 0) {
    console.log("  → migrations/061 の再計算で解消する。以後も増えるようなら、");
    console.log("     name_norm を書いているスクリプトが");
    console.log("     scripts/lib/normalize-artist-name.ts を使っているか確認すること。");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
