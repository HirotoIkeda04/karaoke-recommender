import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  const supabase = createAdminClient();
  // Fetch all artists (paginate)
  const all: { id: string; name: string; name_norm: string; genres: string[] | null }[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("artists")
      .select("id, name, name_norm, genres")
      .range(from, from + PAGE - 1)
      .order("name_norm", { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as any));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Total artists: ${all.length}`);

  // Group by display-name (case-insensitive, strip spaces and punctuation) to find display dupes
  function loose(s: string) {
    return s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s\.\-_,'"!?·•・/\\()\[\]{}]+/g, "");
  }
  const groups = new Map<string, typeof all>();
  for (const a of all) {
    const k = loose(a.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }
  const dupes = [...groups.entries()].filter(([, v]) => v.length > 1);
  console.log(`Display-loose duplicate groups: ${dupes.length}`);

  // Sort by group size desc
  dupes.sort((a, b) => b[1].length - a[1].length);

  // Get song counts for these artists
  const ids = dupes.flatMap(([, v]) => v.map((x) => x.id));
  const counts = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    const { data } = await supabase
      .from("artists_with_song_count")
      .select("id, song_count")
      .in("id", slice);
    for (const r of data ?? []) counts.set(r.id as string, (r.song_count as number) ?? 0);
  }

  // Also: any artist whose name contains 嵐
  console.log("\n=== Names containing 嵐 ===");
  for (const a of all.filter((a) => a.name.includes("嵐"))) {
    console.log(`  - "${a.name}"  norm="${a.name_norm}"  id=${a.id}  genres=${JSON.stringify(a.genres)}`);
  }

  for (const [k, group] of dupes.slice(0, 50)) {
    console.log(`\n[${k}]`);
    for (const a of group) {
      console.log(
        `  - "${a.name}"  norm="${a.name_norm}"  songs=${counts.get(a.id) ?? 0}  id=${a.id}  genres=${JSON.stringify(a.genres)}`,
      );
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
