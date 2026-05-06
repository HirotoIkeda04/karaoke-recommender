/**
 * DAM 公式ランキングページから (title, artist) を抽出し、新規曲を DB に追加する。
 *
 * 法的:
 *  - DAM の robots.txt は /ranking/ を Disallow していない (2026-05-06 確認)
 *  - 楽曲タイトル / アーティスト名は事実情報で著作物性は弱い
 *  - 順位や DAM 請求番号は **保存しない** (引用枠を超えない)
 *  - User-Agent に連絡先を明記、間隔 2s で礼儀よく
 *
 * 対象 URL (現時点で取得可能なもの):
 *  Tier 1 - メイン:
 *    /ranking/index.html       (日次/週次/月次 TOP 100 が同 HTML 内)
 *    /ranking/firsthalf.html   2025 上半期 TOP 100
 *    /ranking/secondhalf.html  2025 下半期 TOP 100
 *    /ranking/year.html        2025 年間 TOP 100
 *  Tier 2 - ジャンル別:
 *    /genre/{anison,enka,foreign}/ranking_{year,firsthalf,secondhalf}.html
 *
 * 抽出ロジック:
 *  HTML 内の <h4 class="p-song__title">...</h4> と直後の
 *  <div class="p-song__artist">...</div> を順番にペアリング。
 *
 * 使い方:
 *   pnpm seed:dam-ranking --dry-run    # 抽出件数のみ
 *   pnpm seed:dam-ranking              # DB 投入
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];
type ArtistInsert = Database["public"]["Tables"]["artists"]["Insert"];

const UA =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";
const FETCH_INTERVAL_MS = 2000;

const URLS: Array<{ url: string; label: string }> = [
  // --- メインランキング ---
  { url: "https://www.clubdam.com/ranking/", label: "main daily/weekly/monthly" },
  { url: "https://www.clubdam.com/ranking/firsthalf.html", label: "2025 firsthalf" },
  { url: "https://www.clubdam.com/ranking/secondhalf.html", label: "2025 secondhalf" },
  { url: "https://www.clubdam.com/ranking/year.html", label: "2025 year" },
  // --- メインランキング派生 ---
  { url: "https://www.clubdam.com/ranking/kensaku/", label: "kensaku (search volume)" },
  { url: "https://www.clubdam.com/ranking/burst/", label: "burst (急上昇)" },
  { url: "https://www.clubdam.com/ranking/duet/", label: "duet" },
  // --- ジャンル別 ---
  { url: "https://www.clubdam.com/genre/anison/ranking_year.html", label: "anison year" },
  { url: "https://www.clubdam.com/genre/anison/ranking_firsthalf.html", label: "anison firsthalf" },
  { url: "https://www.clubdam.com/genre/anison/ranking_secondhalf.html", label: "anison secondhalf" },
  { url: "https://www.clubdam.com/genre/enka/ranking_year.html", label: "enka year" },
  { url: "https://www.clubdam.com/genre/enka/ranking_firsthalf.html", label: "enka firsthalf" },
  { url: "https://www.clubdam.com/genre/enka/ranking_secondhalf.html", label: "enka secondhalf" },
  { url: "https://www.clubdam.com/genre/foreign/ranking_year.html", label: "foreign year" },
  { url: "https://www.clubdam.com/genre/foreign/ranking_firsthalf.html", label: "foreign firsthalf" },
  { url: "https://www.clubdam.com/genre/foreign/ranking_secondhalf.html", label: "foreign secondhalf" },
  { url: "https://www.clubdam.com/genre/vocaloid/ranking_year.html", label: "vocaloid year" },
  { url: "https://www.clubdam.com/genre/vocaloid/ranking_firsthalf.html", label: "vocaloid firsthalf" },
  { url: "https://www.clubdam.com/genre/vocaloid/ranking_secondhalf.html", label: "vocaloid secondhalf" },
  { url: "https://www.clubdam.com/genre/vtuber/ranking_firsthalf.html", label: "vtuber firsthalf" },
  // --- 季節アニメ別 (2021 H2 - 2025 で実在分のみ) ---
  { url: "https://www.clubdam.com/feature/standard/winter_anime_ranking_2025.html", label: "anime 2025 winter" },
  { url: "https://www.clubdam.com/feature/standard/spring_anime_ranking_2025.html", label: "anime 2025 spring" },
  { url: "https://www.clubdam.com/feature/standard/summer_anime_ranking_2025.html", label: "anime 2025 summer" },
  { url: "https://www.clubdam.com/feature/standard/winter_anime_ranking_2024.html", label: "anime 2024 winter" },
  { url: "https://www.clubdam.com/feature/standard/spring_anime_ranking_2024.html", label: "anime 2024 spring" },
  { url: "https://www.clubdam.com/feature/standard/summer_anime_ranking_2024.html", label: "anime 2024 summer" },
  { url: "https://www.clubdam.com/feature/standard/autumn_anime_ranking_2024.html", label: "anime 2024 autumn" },
  { url: "https://www.clubdam.com/feature/standard/winter_anime_ranking_2023.html", label: "anime 2023 winter" },
  { url: "https://www.clubdam.com/feature/standard/spring_anime_ranking_2023.html", label: "anime 2023 spring" },
  { url: "https://www.clubdam.com/feature/standard/summer_anime_ranking_2023.html", label: "anime 2023 summer" },
  { url: "https://www.clubdam.com/feature/standard/autumn_anime_ranking_2023.html", label: "anime 2023 autumn" },
  { url: "https://www.clubdam.com/feature/standard/winter_anime_ranking_2022.html", label: "anime 2022 winter" },
  { url: "https://www.clubdam.com/feature/standard/spring_anime_ranking_2022.html", label: "anime 2022 spring" },
  { url: "https://www.clubdam.com/feature/standard/summer_anime_ranking_2022.html", label: "anime 2022 summer" },
  { url: "https://www.clubdam.com/feature/standard/autumn_anime_ranking_2022.html", label: "anime 2022 autumn" },
  { url: "https://www.clubdam.com/feature/standard/winter_anime_ranking_2021.html", label: "anime 2021 winter" },
  { url: "https://www.clubdam.com/feature/standard/spring_anime_ranking_2021.html", label: "anime 2021 spring" },
  { url: "https://www.clubdam.com/feature/standard/summer_anime_ranking_2021.html", label: "anime 2021 summer" },
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/** タイトル末尾の 『アニメ名』 タイアップ表記を剥がす。
 *  例: "聖者の行進 『平穏世代の韋駄天達』" → "聖者の行進"
 *  「...」 (鉤括弧 1 重) は曲名に組み込まれる例があるため対象外。 */
function stripAnimeSuffix(title: string): string {
  return title.replace(/[ 　]*『[^』]*』[ 　]*$/, "").trim();
}

function extractSongsFromHtml(html: string, label: string): ScrapedSong[] {
  // <h4 class="p-song__title">...</h4> ... <div class="p-song__artist">...</div>
  // が順番に並んでいる前提でペアリング。
  const titleRe = /<h4 class="p-song__title">([\s\S]*?)<\/h4>/g;
  const artistRe = /<div class="p-song__artist">([\s\S]*?)<\/div>/g;
  const titles: string[] = [];
  const artists: string[] = [];
  for (const m of html.matchAll(titleRe)) titles.push(decodeHtmlEntities(m[1].trim()));
  for (const m of html.matchAll(artistRe)) artists.push(decodeHtmlEntities(m[1].trim()));

  // artist の方は「曲名行のすぐ後」と「アーティスト単独行 (p-song--artist 内)」両方が
  // 含まれて、おおむね倍の数になる傾向。実 HTML を見ると曲行の各 artist 出現位置に
  // 同じ artist 名が 2 回 (曲行内 + 直後の artist 単独セクション) 出るため、
  // titles と一対一にはならない。
  // → タイトル位置の文字列オフセットで近傍 artist を引く方式に変える。
  const songs: ScrapedSong[] = [];
  let pos = 0;
  for (const tm of html.matchAll(titleRe)) {
    const tEnd = (tm.index ?? 0) + tm[0].length;
    // 直後 (~600 文字以内) の最初の p-song__artist を artist とする
    const window = html.slice(tEnd, tEnd + 600);
    const am = window.match(/<div class="p-song__artist">([\s\S]*?)<\/div>/);
    if (!am) continue;
    const titleRaw = decodeHtmlEntities(tm[1].trim());
    const artist = decodeHtmlEntities(am[1].trim());
    const title = stripAnimeSuffix(titleRaw);
    if (!title || !artist) continue;
    songs.push({ title, artist, source_label: label });
    pos = tEnd;
  }
  void pos;
  void titles;
  void artists;
  return songs;
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

  // 1. 各 URL を取得して曲を抽出
  const allScraped: ScrapedSong[] = [];
  for (const { url, label } of URLS) {
    process.stdout.write(`fetching ${label}...`);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) {
        console.log(` HTTP ${res.status} (skip)`);
        continue;
      }
      const html = await res.text();
      const songs = extractSongsFromHtml(html, label);
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
    const key = normalizeArtistName(s.artist) + "|" + normalizeForDedup(s.title);
    if (!uniqByKey.has(key)) uniqByKey.set(key, s);
  }
  const unique = Array.from(uniqByKey.values());
  console.log(`unique (artist, title): ${unique.length}`);

  // 3. 既存 DB を読み込んで重複判定
  const dbArtists: Array<{ id: string; name: string; name_norm: string }> = [];
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
        .select("title, artist_id, artist")
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        // artist_id ベース + artist 文字列 両方で dedup key を作る
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
      // 新規アーティストとして登録予定
      newArtists.set(aKey, {
        name: s.artist,
        name_norm: aKey,
        genres: [],
      });
      newSongs.push(s); // artistId は INSERT 後に解決
    }
  }
  console.log(
    `\nnew songs to insert: ${newSongs.length} (${alreadyInDb} already in DB)`,
  );
  console.log(`new artists to create: ${newArtists.size}`);

  console.log("\n=== sample new songs ===");
  for (const s of newSongs.slice(0, 20)) {
    console.log(`  ${s.artist}\t${s.title}\t[${s.source_label}]`);
  }

  if (dryRun) {
    console.log("\nDRY-RUN: no writes performed.");
    return;
  }

  // 5. 新規アーティストを batch INSERT
  if (newArtists.size > 0) {
    const rows = Array.from(newArtists.values());
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { data, error } = await supabase
        .from("artists")
        .insert(batch)
        .select("id, name, name_norm");
      if (error) {
        console.error(`  artist insert ${i}: ${error.message}`);
        continue;
      }
      for (const a of data ?? []) {
        artistByNorm.set(normalizeArtistName(a.name), {
          id: a.id,
          name: a.name,
        });
      }
    }
    console.log(`inserted ${newArtists.size} new artists`);
  }

  // 6. 新規曲を batch INSERT (artistId を解決)
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
      source_urls: ["https://www.clubdam.com/ranking/"],
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
