/**
 * JOYSOUND のアーティストページから読み仮名を取得し、artists.name_kana を埋める。
 *
 * 法的:
 *  - JOYSOUND の robots.txt が Disallow しているのは /utasuki/ と /web/joy/movie/ のみ。
 *    ここで叩く /web/search/artist* は対象外 (2026-08-24 確認)。
 *  - User-Agent に連絡先を明記、間隔 2s、取得済みは jsonl キャッシュで再取得しない。
 *  - 読み仮名は事実情報。JOYSOUND の内部 ID はキャッシュにのみ残し、DB には入れない。
 *
 * なぜ JOYSOUND か:
 *  カラオケ DB は元々アーティストを五十音で引けるように読みを持っているので、
 *  カバー率と精度がこの用途では最も高い。Wikidata の P1814 は上位 120 件中 52 件
 *  しか無くグループ名に弱い。「175R → イナゴライダー」「AAA → トリプルエー」の
 *  ような読みは公式データ以外では当てられない。
 *  DAM は robots.txt が /app/leaf/artistKaraokeAtDam/ を Disallow しているので使わない。
 *
 * 同定:
 *  検索結果は「米津玄師」に対して「DAOKO × 米津玄師」「ハチ/米津玄師」なども返す。
 *  上位 1 件を無条件に採ると誤同定するので、候補名を正規化して完全一致した
 *  ものだけを採用する。1 件も一致しない場合は括弧書き等を落とした名前で
 *  引き直し、それでも駄目なら未取得として残す (推測はしない)。
 *
 * 使い方:
 *   pnpm fetch:joysound-kana -- --dry-run --limit 20
 *   pnpm fetch:joysound-kana -- --limit 300
 *   pnpm fetch:joysound-kana -- --refresh   # キャッシュを無視して取り直す
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

const UA =
  "karaoke-recommender-research/0.2 (hiroto.lalapalooza.ikeda@gmail.com)";
const FETCH_INTERVAL_MS = 2000;
const BASE = "https://www.joysound.com";
const CACHE_PATH = path.resolve("scraper/cache/joysound-artist-kana.jsonl");
const DB_PAGE_SIZE = 1000;

type CacheRow = {
  artist_id: string;
  name: string;
  /** JOYSOUND 側の表記。同定の妥当性を後から検証できるように残す */
  matched_name: string | null;
  joysound_id: string | null;
  kana: string | null;
  status: "ok" | "no_match" | "no_kana";
  fetched_at: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const num = (flag: string) => {
    const i = args.indexOf(flag);
    if (i < 0) return null;
    const v = Number.parseInt(args[i + 1] ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  return {
    dryRun: args.includes("--dry-run"),
    refresh: args.includes("--refresh"),
    // no_match / no_kana で終わった行だけ引き直す (同定ロジックを直したとき用)
    retryFailed: args.includes("--retry-failed"),
    limit: num("--limit"),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * 同定用の比較キー。DB の name_search (migrations/060) と同じ発想で
 * 記号を落としカナを畳むが、こちらは照合専用なので区切り記号 (、／＝) や
 * 全角スペースまで踏み込んで落とす。DB には一切書かない。
 */
function compareKey(s: string): string {
  const stripped = s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.\-_,、，!?'"’“”・･/\\()[\]{}（）「」『』【】&＆=＝+＋~〜:：;；*#@]/g, "");
  let out = "";
  for (const ch of stripped) {
    const code = ch.codePointAt(0)!;
    // カタカナ → ひらがな
    const c =
      code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
    // 小書き → 大書き
    const small = "ぁぃぅぇぉっゃゅょゎゕゖ";
    const large = "あいうえおつやゆよわかけ";
    const i = small.indexOf(c);
    out += i >= 0 ? large[i] : c;
  }
  return out;
}

/** 末尾の括弧書きを落とす。「19(ジューク)」「XG (XG)」「Creepy Nuts(R-指定&DJ松永)」用 */
function stripParens(name: string): string {
  return name.replace(/[(（][^)）]*[)）]/g, "").trim();
}

/** feat. 以降を落とす。「すりぃ feat.鏡音レン」のように空白が無い表記もある */
function stripFeat(name: string): string {
  const m = name.match(/\s*(?:feat|ft|featuring)\.?\s*/i);
  return m && m.index != null && m.index > 0 ? name.slice(0, m.index).trim() : name;
}

/** 括弧の中身。「ゴスペラーズ(The Gospellers)」は JOYSOUND では The Gospellers 名義 */
function parenContent(name: string): string {
  return name.match(/[(（]([^)）]+)[)）]/)?.[1].trim() ?? "";
}

/**
 * 表記の候補。元名で引けなかったときの逃げ道で、前にあるものほど確実。
 *   星野 源              → 星野源   (JOYSOUND は空白なしで登録)
 *   すりぃ feat.鏡音レン  → すりぃ
 *   19(ジューク)          → 19
 *   ゴスペラーズ(The Gospellers) → The Gospellers
 *
 * 括弧の中身は最後に回す。「ビートまりお(COOL&CREATE)」のように中身が
 * 別名ではなくサークル名のこともあり、単独で引くと別人に当たりうるため。
 */
function nameVariants(name: string): string[] {
  const out = [
    name,
    stripParens(name),
    stripFeat(name),
    name.replace(/\s+/g, ""),
    parenContent(name),
  ];
  return [...new Set(out.filter((v) => v.length > 0))];
}

async function fetchText(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt === 2) {
        console.warn(`  fetch 失敗 ${url}: ${(e as Error).message}`);
        return null;
      }
      await sleep(FETCH_INTERVAL_MS * (attempt + 2));
    }
  }
  return null;
}

/** 検索結果ページから (JOYSOUND ID, 表示名) の候補を順に拾う */
function parseCandidates(html: string): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const re =
    /href="\/web\/search\/artist\/(\d+)"[\s\S]{0,600}?text-l[^>]*>([^<]{1,80})</g;
  for (const m of html.matchAll(re)) {
    const id = m[1];
    if (out.some((c) => c.id === id)) continue;
    out.push({ id, name: decodeHtmlEntities(m[2]).trim() });
  }
  return out;
}

/**
 * アーティストページの見出し直下から読みを取る。
 *   <h1 ...>米津玄師</h1></div><p ...>(<!-- -->ヨネヅケンシ<!-- -->)</p>
 */
function parseArtistPage(
  html: string,
): { name: string; kana: string | null } | null {
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  if (!h1) return null;
  const kana = html.match(/<\/h1><\/div><p[^>]*>\((?:<!-- -->)?([^<)]+)/);
  return {
    name: decodeHtmlEntities(h1[1]).trim(),
    kana: kana ? decodeHtmlEntities(kana[1]).trim() : null,
  };
}

/**
 * 検索して、名前が一致する候補だけを返す。
 *
 * 一致判定は両側に同じ前処理をかける。JOYSOUND 側も「19(ジューク)」
 * 「XG (XG)」のように読みや別表記を括弧で足していることがあるため。
 * ここを緩めずに完全一致で縛るのは、「Creepy Nuts × 菅田将暉」のような
 * コラボ名義を本人と取り違えないため。
 *
 * match=1 は絞り込みが強い一方で「内田雄馬」のように本人が落ちる場合が
 * あるので、駄目なら match 無しでも引く。
 */
async function resolveArtist(
  name: string,
): Promise<{ id: string; name: string } | null> {
  // 照合キーは検索に使う表記と同じ集合から作る。ここを元名だけにすると
  // 「すりぃ feat.鏡音レン」で "すりぃ" を検索しておきながら、候補の
  // "すりぃ" を弾いてしまう。
  const variants = nameVariants(name);
  const want = new Set(
    variants.flatMap((v) => [compareKey(v), compareKey(stripParens(v))]),
  );
  want.delete("");
  for (const q of variants) {
    for (const mode of ["&match=1", ""]) {
      const url = `${BASE}/web/search/artist?keyword=${encodeURIComponent(q)}${mode}`;
      const html = await fetchText(url);
      await sleep(FETCH_INTERVAL_MS);
      if (!html) continue;
      const hit = parseCandidates(html).find(
        (c) =>
          want.has(compareKey(c.name)) ||
          want.has(compareKey(stripParens(c.name))),
      );
      if (hit) {
        if (q !== name || mode === "") {
          console.log(`  別表記で一致: "${q}"${mode ? "" : " (match 指定なし)"}`);
        }
        return hit;
      }
    }
  }
  return null;
}

async function main() {
  const { dryRun, refresh, retryFailed, limit } = parseArgs();
  const supabase = createAdminClient();

  // 曲数の多い順。有名アーティストから埋まるようにする
  const artists: Array<{ id: string; name: string; song_count: number }> = [];
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("artists_with_song_count")
      .select("id, name, song_count")
      .order("song_count", { ascending: false, nullsFirst: false })
      .range(from, from + DB_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.id && row.name) {
        artists.push({
          id: row.id,
          name: row.name,
          song_count: row.song_count ?? 0,
        });
      }
    }
    if (data.length < DB_PAGE_SIZE) break;
  }

  const cache = new Map<string, CacheRow>();
  if (existsSync(CACHE_PATH) && !refresh) {
    for (const line of readFileSync(CACHE_PATH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as CacheRow;
      cache.set(row.artist_id, row);
    }
  }
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true });

  const targets = artists
    .filter((a) => {
      const cached = cache.get(a.id);
      return !cached || (retryFailed && cached.status !== "ok");
    })
    .slice(0, limit ?? artists.length);
  console.log(
    `artists=${artists.length} cached=${cache.size} 今回取得=${targets.length}` +
      (dryRun ? " (dry-run)" : ""),
  );

  const fetched: CacheRow[] = [];
  for (const [i, artist] of targets.entries()) {
    const matched = await resolveArtist(artist.name);
    let row: CacheRow;
    if (!matched) {
      row = {
        artist_id: artist.id,
        name: artist.name,
        matched_name: null,
        joysound_id: null,
        kana: null,
        status: "no_match",
        fetched_at: new Date().toISOString(),
      };
    } else {
      const html = await fetchText(`${BASE}/web/search/artist/${matched.id}`);
      await sleep(FETCH_INTERVAL_MS);
      const page = html ? parseArtistPage(html) : null;
      row = {
        artist_id: artist.id,
        name: artist.name,
        matched_name: matched.name,
        joysound_id: matched.id,
        kana: page?.kana ?? null,
        status: page?.kana ? "ok" : "no_kana",
        fetched_at: new Date().toISOString(),
      };
    }
    fetched.push(row);
    cache.set(artist.id, row);
    appendFileSync(CACHE_PATH, JSON.stringify(row) + "\n");
    const mark = row.status === "ok" ? "○" : "×";
    console.log(
      `[${i + 1}/${targets.length}] ${mark} ${artist.name} (${artist.song_count}曲) -> ${row.kana ?? row.status}`,
    );
  }

  const ok = [...cache.values()].filter((r) => r.status === "ok");
  console.log(
    `\n読み取得済み ${ok.length} / キャッシュ ${cache.size}` +
      ` (no_match=${[...cache.values()].filter((r) => r.status === "no_match").length}` +
      ` no_kana=${[...cache.values()].filter((r) => r.status === "no_kana").length})`,
  );

  if (dryRun) {
    console.log("dry-run のため DB は更新しない");
    return;
  }

  let updated = 0;
  for (const row of ok) {
    const { error } = await supabase
      .from("artists")
      .update({ name_kana: row.kana })
      .eq("id", row.artist_id);
    if (error) {
      console.error(`  更新失敗 ${row.name}: ${error.message}`);
      continue;
    }
    updated++;
  }
  console.log(`artists.name_kana を ${updated} 件更新`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
