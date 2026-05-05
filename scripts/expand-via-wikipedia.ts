/**
 * Wikipedia / Wikidata 経由で artist あたりの楽曲一覧を取得し、
 * DB の `songs` テーブルへ新規曲を INSERT する。
 *
 * 法的:
 *  - Wikidata は CC0 → 帰属表示不要
 *  - JP Wikipedia 由来の article 名等を保存するが、本スクリプトが取得するのは
 *    曲タイトル (factual) と Q-ID (純粋識別子) のみで著作物性は薄い
 *  - User-Agent に連絡先を明記 (Wikimedia 規約)
 *
 * 処理フロー:
 *  1. DB から artists を読み出す
 *  2. artist.wikidata_qid 未解決なら Wikipedia (action=query) で解決
 *     -> 解決できたら artists テーブルへ書き戻す (次回スキップのため)
 *  3. SPARQL で `?song wdt:P175 wd:<qid>` の楽曲一覧 + 発売日を取得
 *  4. 既存の (artist_id, normalized title) と重複しない曲のみ INSERT
 *
 * 使い方:
 *   pnpm expand:wikipedia                    # 全アーティスト処理
 *   pnpm expand:wikipedia -- --limit 5       # 先頭 5 アーティストだけ (動作確認)
 *   pnpm expand:wikipedia -- --dry-run       # INSERT せず結果サマリのみ
 *   pnpm expand:wikipedia -- --limit 5 --dry-run
 */
import { createAdminClient } from "../src/lib/supabase/admin";

// --- Configuration ----------------------------------------------------------

const USER_AGENT =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";

const WIKIPEDIA_API = "https://ja.wikipedia.org/w/api.php";
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

// Wikimedia は 100 req/sec まで許容するが行儀よく 1 req/1s。
const SLEEP_MS = 1000;

const MAX_SONGS_PER_ARTIST = 100;

// --- Types ------------------------------------------------------------------

interface ArtistRow {
  id: string;
  name: string;
  wikidata_qid: string | null;
  wikipedia_article: string | null;
}

interface ExistingSongRow {
  title: string;
  artist_id: string | null;
  wikidata_qid: string | null;
}

interface WikidataSong {
  qid: string;
  title: string;
  releaseYear: number | null;
}

interface ArtistSummary {
  artist: string;
  status: "qid_resolved" | "qid_cached" | "qid_failed";
  qid: string | null;
  fetchedSongs: number;
  newSongs: number;
  duplicates: number;
}

// --- Utilities --------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 比較用に title を正規化 (text_match.py の TS 移植簡易版)。*/
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = parseInt(args[i + 1] ?? "0", 10);
    else if (args[i] === "--dry-run") dryRun = true;
  }
  return { limit, dryRun };
}

// --- Wikipedia: artist name -> Wikidata Q-ID --------------------------------

/** Wikipedia 記事タイトル候補一覧 (フォールバック用)。
 *  例: "松任谷由実(荒井由実)" → ["松任谷由実(荒井由実)", "松任谷由実"]
 *      "ちゃんみな、No No Girls FINALISTS" → 元 + "ちゃんみな"
 */
function generateNameVariants(name: string): string[] {
  const variants = new Set<string>();
  variants.add(name);
  // カッコ除去 (全角・半角)
  const stripped = name
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .trim();
  if (stripped && stripped !== name) variants.add(stripped);
  // 「、」「,」「&」「×」での分割 (先頭のみ採用)
  for (const sep of ["、", ",", " & ", " × ", "×"]) {
    if (name.includes(sep)) {
      const head = name.split(sep)[0]?.trim();
      if (head) {
        variants.add(head);
        const headStripped = head
          .replace(/[（(][^）)]*[）)]/g, "")
          .replace(/[[【][^\]】]*[\]】]/g, "")
          .trim();
        if (headStripped) variants.add(headStripped);
      }
    }
  }
  return Array.from(variants);
}

async function queryWikipediaForQid(
  title: string,
): Promise<{ qid: string | null; article: string | null }> {
  const url = new URL(WIKIPEDIA_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", title);
  url.searchParams.set("prop", "pageprops|info");
  url.searchParams.set("ppprop", "wikibase_item");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`wikipedia api ${res.status}`);
  }
  const json = (await res.json()) as {
    query?: {
      pages?: Array<{
        title?: string;
        missing?: boolean;
        pageprops?: { wikibase_item?: string };
      }>;
    };
  };
  const page = json.query?.pages?.[0];
  if (!page || page.missing) return { qid: null, article: null };
  return { qid: page.pageprops?.wikibase_item ?? null, article: page.title ?? null };
}

async function resolveArtistQid(
  artistName: string,
): Promise<{ qid: string | null; article: string | null }> {
  const variants = generateNameVariants(artistName);
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const r = await queryWikipediaForQid(v);
    if (r.qid) return r;
    // 複数 variant を試す時は連続呼び出しの間に sleep
    if (i < variants.length - 1) await sleep(SLEEP_MS);
  }
  return { qid: null, article: null };
}

// --- Wikidata SPARQL: artist Q-ID -> songs ---------------------------------

async function fetchSongsByArtistQid(qid: string): Promise<WikidataSong[]> {
  // P175 (performer) が指定アーティスト。
  //
  // 「P31/P279* で Q7366 の派生」フィルタは Wikidata の taxonomy が中途半端なため
  // single (Q134556) 等を取りこぼす。代わりに明確に楽曲ではないもの (album/EP/
  // compilation/video) のみを除外する。
  // P577 (publication date) を OPTIONAL で取得 (release_year に使う)。
  const sparql = `
    SELECT DISTINCT ?song ?songLabel ?date WHERE {
      ?song wdt:P175 wd:${qid}.
      FILTER NOT EXISTS { ?song wdt:P31 wd:Q482994. }   # album
      FILTER NOT EXISTS { ?song wdt:P31 wd:Q209939. }   # studio album
      FILTER NOT EXISTS { ?song wdt:P31 wd:Q24862. }    # compilation album
      FILTER NOT EXISTS { ?song wdt:P31 wd:Q209598. }   # extended play (EP)
      FILTER NOT EXISTS { ?song wdt:P31 wd:Q220935. }   # live album
      FILTER NOT EXISTS { ?song wdt:P31 wd:Q108352648. } # video album
      FILTER NOT EXISTS { ?song wdt:P31 wd:Q482994. }   # album (再掲: 安全のため)
      OPTIONAL { ?song wdt:P577 ?date }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en,en-us". }
    }
    LIMIT ${MAX_SONGS_PER_ARTIST}
  `.trim();

  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(sparql)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/sparql-results+json",
    },
  });
  if (!res.ok) {
    throw new Error(`wikidata sparql ${res.status}`);
  }
  const json = (await res.json()) as {
    results?: {
      bindings?: Array<{
        song?: { value?: string };
        songLabel?: { value?: string };
        date?: { value?: string };
      }>;
    };
  };
  const seen = new Map<string, WikidataSong>();
  for (const b of json.results?.bindings ?? []) {
    const songUri = b.song?.value;
    const label = b.songLabel?.value;
    if (!songUri || !label) continue;
    const qid = songUri.split("/").pop()!;
    // songLabel が Q-ID そのまま (= ja/en label が無かった) なら捨てる
    if (/^Q\d+$/.test(label)) continue;
    const dateRaw = b.date?.value;
    const year = dateRaw ? parseInt(dateRaw.slice(0, 4), 10) : null;
    const existing = seen.get(qid);
    // 同じ song に複数の date binding が来た時は早い方を採用
    if (!existing || (year !== null && (existing.releaseYear === null || year < existing.releaseYear))) {
      seen.set(qid, { qid, title: label, releaseYear: year });
    }
  }
  return Array.from(seen.values());
}

// --- Main -------------------------------------------------------------------

async function main() {
  const { limit, dryRun } = parseArgs();
  const supabase = createAdminClient();

  // 1) artists を全件読み込む (PostgREST default 1000 row 制限を回避するためページング)。
  const artists: ArtistRow[] = [];
  {
    let offset = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await supabase
        .from("artists")
        .select("id, name, wikidata_qid, wikipedia_article")
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as ArtistRow[];
      artists.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }
  const targets = limit !== null ? artists.slice(0, limit) : artists;
  console.log(
    `total artists in DB: ${artists.length}, processing: ${targets.length}, dryRun=${dryRun}`,
  );

  // 2) 既存 songs の (artist_id, normalized title) と (wikidata_qid) インデックスを作る。
  //    PostgREST の row 上限 1000 を回避するためページング。
  const existingTitlesByArtist = new Map<string, Set<string>>();
  const existingSongQids = new Set<string>();
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("songs")
      .select("title, artist_id, wikidata_qid")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as ExistingSongRow[];
    for (const r of rows) {
      if (r.wikidata_qid) existingSongQids.add(r.wikidata_qid);
      if (r.artist_id) {
        const norm = normalizeTitle(r.title);
        let s = existingTitlesByArtist.get(r.artist_id);
        if (!s) {
          s = new Set();
          existingTitlesByArtist.set(r.artist_id, s);
        }
        s.add(norm);
      }
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  console.log(
    `loaded existing songs: ${existingSongQids.size} with qid, ${
      Array.from(existingTitlesByArtist.values()).reduce((a, s) => a + s.size, 0)
    } titles indexed`,
  );

  // 3) 各 artist を順次処理。
  const summaries: ArtistSummary[] = [];
  let totalNew = 0;
  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    const summary: ArtistSummary = {
      artist: a.name,
      status: "qid_failed",
      qid: a.wikidata_qid,
      fetchedSongs: 0,
      newSongs: 0,
      duplicates: 0,
    };

    try {
      // 3a) Q-ID 未解決なら Wikipedia で解決。
      let qid = a.wikidata_qid;
      let article = a.wikipedia_article;
      if (qid) {
        summary.status = "qid_cached";
      } else {
        const r = await resolveArtistQid(a.name);
        await sleep(SLEEP_MS);
        qid = r.qid;
        article = r.article;
        if (qid) {
          summary.status = "qid_resolved";
          if (!dryRun) {
            await supabase
              .from("artists")
              .update({ wikidata_qid: qid, wikipedia_article: article })
              .eq("id", a.id);
          }
        } else {
          summary.status = "qid_failed";
          summaries.push(summary);
          if ((i + 1) % 25 === 0) console.log(`  progress: ${i + 1}/${targets.length}`);
          continue;
        }
      }
      summary.qid = qid;

      // 3b) SPARQL で楽曲取得。
      const songs = await fetchSongsByArtistQid(qid);
      await sleep(SLEEP_MS);
      summary.fetchedSongs = songs.length;

      // 3c) dedup -> 新規分のみ収集。
      const existingTitles = existingTitlesByArtist.get(a.id) ?? new Set<string>();
      const inserts: Array<Record<string, unknown>> = [];
      for (const s of songs) {
        if (existingSongQids.has(s.qid)) {
          summary.duplicates++;
          continue;
        }
        const norm = normalizeTitle(s.title);
        if (existingTitles.has(norm)) {
          summary.duplicates++;
          continue;
        }
        inserts.push({
          title: s.title,
          artist: a.name,
          artist_id: a.id,
          release_year: s.releaseYear,
          wikidata_qid: s.qid,
          wikipedia_article: null,
          is_popular: true,
          source_urls: [`https://www.wikidata.org/wiki/${s.qid}`],
        });
        // 同一バッチ内の二重防止
        existingTitles.add(norm);
        existingSongQids.add(s.qid);
      }
      existingTitlesByArtist.set(a.id, existingTitles);
      summary.newSongs = inserts.length;
      totalNew += inserts.length;

      // 3d) INSERT (ignore-on-conflict 相当: wikidata_qid unique で衝突無視)
      if (!dryRun && inserts.length > 0) {
        const { error: insErr } = await supabase
          .from("songs")
          .upsert(inserts, { onConflict: "wikidata_qid", ignoreDuplicates: true });
        if (insErr) {
          console.error(`  insert error for ${a.name}:`, insErr.message);
        }
      }
    } catch (e: unknown) {
      console.error(`  error processing ${a.name}:`, (e as Error).message);
    }

    summaries.push(summary);
    if ((i + 1) % 25 === 0 || i === targets.length - 1) {
      console.log(
        `  progress: ${i + 1}/${targets.length} (totalNew=${totalNew})`,
      );
    }
  }

  // 4) サマリ
  const stats = {
    total: summaries.length,
    qid_resolved: summaries.filter((s) => s.status === "qid_resolved").length,
    qid_cached: summaries.filter((s) => s.status === "qid_cached").length,
    qid_failed: summaries.filter((s) => s.status === "qid_failed").length,
    totalFetched: summaries.reduce((a, s) => a + s.fetchedSongs, 0),
    totalNew,
    totalDup: summaries.reduce((a, s) => a + s.duplicates, 0),
  };
  console.log("\n=== summary ===");
  console.log(JSON.stringify(stats, null, 2));
  if (limit !== null && limit <= 10) {
    console.log("\nper-artist detail:");
    for (const s of summaries) {
      console.log(
        `  ${s.artist} [${s.status} ${s.qid ?? "-"}]: fetched=${s.fetchedSongs}, new=${s.newSongs}, dup=${s.duplicates}`,
      );
    }
  }
  console.log(`\ndone (${dryRun ? "DRY-RUN" : "applied"}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
