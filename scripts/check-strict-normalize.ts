// 厳格化した normalize 関数を全 artists にあてて衝突を事前検出
import { createAdminClient } from "@/lib/supabase/admin";

// 新しい normalize: NFKC + lower + 空白/ドット/括弧/中点を完全除去
function strictNormalize(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\.\-_,'"!?·•・/\\()\[\]{}（）「」『』【】]+/g, "");
}

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
    const k = strictNormalize(a.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }

  const collisions = [...groups.entries()].filter(([, v]) => v.length > 1);
  console.log(`Collisions under strict normalize: ${collisions.length}`);
  for (const [k, group] of collisions) {
    console.log(`\n[${k}]`);
    for (const a of group) console.log(`  - "${a.name}"  (id=${a.id})`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
