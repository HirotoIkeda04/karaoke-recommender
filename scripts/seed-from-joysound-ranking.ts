/**
 * JOYSOUND 公式ランキングページから (title, artist) を抽出し、新規曲を DB に追加する。
 *
 * 法的:
 *  - JOYSOUND の robots.txt は /utasuki/ と /web/joy/movie/ のみ Disallow
 *  - /web/s/karaoke/contents/* と /web/s/30th/* は明示禁止無し
 *  - 楽曲タイトル・アーティスト名は事実情報。順位や JOYSOUND ID は保存しない
 *  - User-Agent に連絡先明記、間隔 2s
 *
 * DAM ランキングでは届かなかった「過去年の人気曲」「30 周年の歴史的名曲」を
 * 補完する目的で実装。
 *
 * 対応する HTML フォーマット:
 *  A. table 形式 (annual_ranking, contents/ranking/YYYY-MM, annual_age):
 *     <td class="jp-page-sl-cell-song"><a href="/web/search/song/N">title</a></td>
 *     <td class="jp-page-sl-cell-artist"><a href="/web/search/artist/N">artist</a></td>
 *  B. 30th 形式 (/web/s/30th/ranking):
 *     <h4 class="rank-total-title"><a ...>title</a></h4>
 *     <p class="rank-total-artist"><a ...>artist</a></p>
 *
 * 使い方:
 *   pnpm seed:joysound-ranking --dry-run
 *   pnpm seed:joysound-ranking
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];
type ArtistInsert = Database["public"]["Tables"]["artists"]["Insert"];

const UA =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";
const FETCH_INTERVAL_MS = 2000;

type Format = "table" | "thirty";

const URLS: Array<{ url: string; label: string; format: Format }> = [
  // --- 年間ランキング (2020-2025) ---
  { url: "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2025", label: "annual 2025", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2024", label: "annual 2024", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2023", label: "annual 2023", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2022", label: "annual 2022", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2021", label: "annual 2021", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/annual_ranking/2020", label: "annual 2020", format: "table" },
  // --- 半期ランキング (各年下半期相当のみ存在) ---
  { url: "https://www.joysound.com/web/s/karaoke/contents/ranking/2025-02", label: "half 2025-02", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/ranking/2024-02", label: "half 2024-02", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/ranking/2023-02", label: "half 2023-02", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/ranking/2022-02", label: "half 2022-02", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/contents/ranking/2021-02", label: "half 2021-02", format: "table" },
  // --- 年代別ランキング ---
  { url: "https://www.joysound.com/web/s/karaoke/feature/annual_age_2025", label: "age 2025", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/feature/annual_age_2024", label: "age 2024", format: "table" },
  { url: "https://www.joysound.com/web/s/karaoke/feature/annual_age_2023", label: "age 2023", format: "table" },
  // --- 30 周年ランキング ---
  { url: "https://www.joysound.com/web/s/30th/ranking", label: "30th anniversary", format: "thirty" },
];

interface ScrapedSong {
  title: string;
  artist: string;
  source_label: string;
}

function parseArgs() {
  return { dryRun: process.argv.slice(2).includes("--dry-run") };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function extractTable(html: string, label: string): ScrapedSong[] {
  // <td class="jp-page-sl-cell-song"><a ...>TITLE</a></td>
  // <td class="jp-page-sl-cell-artist"><a ...>ARTIST</a></td>
  const re =
    /<td class="jp-page-sl-cell-song"><a href="\/web\/search\/song\/\d+"[^>]*>([^<]+)<\/a><\/td>\s*<td class="jp-page-sl-cell-artist"><a href="\/web\/search\/artist\/\d+"[^>]*>([^<]+)<\/a><\/td>/g;
  const out: ScrapedSong[] = [];
  for (const m of html.matchAll(re)) {
    const title = decodeHtmlEntities(m[1]).trim();
    const artist = decodeHtmlEntities(m[2]).trim();
    if (title && artist) out.push({ title, artist, source_label: label });
  }
  return out;
}

function extractThirty(html: string, label: string): ScrapedSong[] {
  // <h4 class="rank-total-title"><a ...>TITLE</a></h4>
  // <p class="rank-total-artist"><a ...>ARTIST</a></p>
  const re =
    /<h4 class="rank-total-title">\s*<a [^>]*>([^<]+)<\/a>\s*<\/h4>\s*<p class="rank-total-artist">\s*<a [^>]*>([^<]+)<\/a>/g;
  const out: ScrapedSong[] = [];
  for (const m of html.matchAll(re)) {
    const title = decodeHtmlEntities(m[1]).trim();
    const artist = decodeHtmlEntities(m[2]).trim();
    if (title && artist) out.push({ title, artist, source_label: label });
  }
  return out;
}

function normalizeForDedup(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/『[^』]*』/g, "")
    .replace(/「[^」]*」/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function normalizeArtistName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim();
}

async function main() {
  const { dryRun } = parseArgs();
  const supabase = createAdminClient();

  // 1. URL を順次取得して抽出
  const allScraped: ScrapedSong[] = [];
  for (const { url, label, format } of URLS) {
    process.stdout.write(`fetching ${label}...`);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) {
        console.log(` HTTP ${res.status} (skip)`);
        continue;
      }
      const html = await res.text();
      const songs =
        format === "table" ? extractTable(html, label) : extractThirty(html, label);
      allScraped.push(...songs);
      console.log(` ${songs.length} songs`);
    } catch (e) {
      console.log(` error: ${(e as Error).message}`);
    }
    await sleep(FETCH_INTERVAL_MS);
  }
  console.log(`\nscraped total (with overlap): ${allScraped.length}`);

  // 2. (artist, title) で dedup
  const uniqByKey = new Map<string, ScrapedSong>();
  for (const s of allScraped) {
    const k = normalizeArtistName(s.artist) + "|" + normalizeForDedup(s.title);
    if (!uniqByKey.has(k)) uniqByKey.set(k, s);
  }
  const unique = Array.from(uniqByKey.values());
  console.log(`unique (artist, title): ${unique.length}`);

  // 3. 既存 DB との重複判定
  const dbArtists: Array<{ id: string; name: string; name_norm: string | null }> = [];
  {
    let offset = 0;
    for (;;) {
      const { data } = await supabase
        .from("artists")
        .select("id, name, name_norm")
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      dbArtists.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  const artistByNorm = new Map<string, { id: string; name: string }>();
  for (const a of dbArtists) {
    const k = normalizeArtistName(a.name);
    if (!artistByNorm.has(k)) artistByNorm.set(k, { id: a.id, name: a.name });
    if (a.name_norm) {
      const k2 = a.name_norm.toLowerCase().replace(/\s+/g, "");
      if (!artistByNorm.has(k2)) artistByNorm.set(k2, { id: a.id, name: a.name });
    }
  }

  const existingSongKeys = new Set<string>();
  {
    let offset = 0;
    for (;;) {
      const { data } = await supabase
        .from("songs")
        .select("title, artist")
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        const aNorm = normalizeArtistName(r.artist || "");
        const tNorm = normalizeForDedup(r.title);
        existingSongKeys.add(aNorm + "|" + tNorm);
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  console.log(`existing DB: ${dbArtists.length} artists, ${existingSongKeys.size} song keys`);

  // 4. 新規分のみフィルタ
  const newArtists = new Map<string, ArtistInsert>();
  const newSongs: Array<ScrapedSong & { artistId?: string }> = [];
  let alreadyInDb = 0;
  for (const s of unique) {
    const aKey = normalizeArtistName(s.artist);
    const sKey = aKey + "|" + normalizeForDedup(s.title);
    if (existingSongKeys.has(sKey)) {
      alreadyInDb++;
      continue;
    }
    const existingArtist = artistByNorm.get(aKey);
    if (existingArtist) {
      newSongs.push({ ...s, artistId: existingArtist.id });
    } else {
      newArtists.set(aKey, {
        name: s.artist,
        name_norm: aKey,
        genres: [],
      });
      newSongs.push(s);
    }
  }
  console.log(
    `\nnew songs to insert: ${newSongs.length} (${alreadyInDb} already in DB)`,
  );
  console.log(`new artists to create: ${newArtists.size}`);

  console.log("\n=== sample new songs ===");
  for (const s of newSongs.slice(0, 25)) {
    console.log(`  ${s.artist}\t${s.title}\t[${s.source_label}]`);
  }

  if (dryRun) {
    console.log("\nDRY-RUN: no writes performed.");
    return;
  }

  // 5. 新規アーティスト batch INSERT
  if (newArtists.size > 0) {
    const rows = Array.from(newArtists.values());
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { data, error } = await supabase
        .from("artists")
        .insert(batch)
        .select("id, name");
      if (error) {
        console.error(`  artist insert ${i}: ${error.message}`);
        continue;
      }
      for (const a of data ?? []) {
        artistByNorm.set(normalizeArtistName(a.name), { id: a.id, name: a.name });
      }
    }
    console.log(`inserted ${newArtists.size} new artists`);
  }

  // 6. 新規曲 batch INSERT
  const songRows: SongInsert[] = [];
  for (const s of newSongs) {
    const artistId =
      s.artistId ?? artistByNorm.get(normalizeArtistName(s.artist))?.id;
    if (!artistId) continue;
    songRows.push({
      title: s.title,
      artist: s.artist,
      artist_id: artistId,
      is_popular: true,
      source_urls: ["https://www.joysound.com/"],
    });
  }

  let inserted = 0;
  for (let i = 0; i < songRows.length; i += 100) {
    const batch = songRows.slice(i, i + 100);
    const { error } = await supabase.from("songs").insert(batch);
    if (error) {
      console.error(`  song insert ${i}: ${error.message}`);
      continue;
    }
    inserted += batch.length;
  }
  console.log(`\ndone. inserted=${inserted} songs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
