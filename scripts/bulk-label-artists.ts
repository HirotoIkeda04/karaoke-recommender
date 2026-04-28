// ============================================================================
// アーティスト ジャンル一括ラベリング (Claude Opus 4.7)
// ============================================================================
// 用途:
//   artists テーブルから未ラベル (genres = '{}') のアーティストを取得し、
//   Claude Opus 4.7 + 構造化出力 (Zod) でバッチラベリングして DB に書き戻す。
//
// 実行:
//   pnpm bulk:label-artists           # 全件処理
//   pnpm bulk:label-artists --limit 50  # 先頭50件だけ (テスト用)
//
// 性質:
//   - 再実行可能: 既ラベル付きはスキップされる
//   - song_count 降順で処理 = 影響の大きいアーティストから埋まる
//   - 1バッチ50件、各バッチ毎に書き込み (途中失敗時の損失を最小化)
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { GENRE_CODES } from "../src/lib/genres";
import { createAdminClient } from "../src/lib/supabase/admin";

const MODEL = "claude-opus-4-7";
const BATCH_SIZE = 50;
const FETCH_PAGE = 1000;

// ----------------------------------------------------------------------------
// プロンプト
// ----------------------------------------------------------------------------

const SYSTEM_PROMPT = `あなたは日本のカラオケ楽曲のジャンル分類専門家です。

# タスク
与えられたアーティスト一覧を、以下の13ジャンルに分類します。
- 1アーティストに複数ジャンルを付けられます (例: LiSA は anison + j_rock)
- 確信が持てるアーティストのみ分類します
- 知らないアーティストや判断が割れるケースは ["other"] とします
- 推測やでっちあげは禁止します

# ジャンル定義 (enum値 / 説明 / 代表例)

## j_pop
大衆向けの邦楽ポップス。
例: あいみょん, 米津玄師, Mrs. GREEN APPLE, Official髭男dism, back number, Vaundy

## j_rock
日本のロックバンド全般。バンドサウンド主体。
例: ONE OK ROCK, RADWIMPS, BUMP OF CHICKEN, スピッツ, Mr.Children, GLAY, B'z, L'Arc-en-Ciel, the GazettE, ELLEGARDEN, ASIAN KUNG-FU GENERATION

## anison
アニメ・特撮の主題歌・劇中歌。声優アーティストもここに含む。
例: LiSA, Aimer, FLOW, 水樹奈々, fripSide, ALI PROJECT, May'n, MISIA (アニメ起用曲)

## vocaloid_utaite
VOCALOID等の合成音声楽曲、歌い手 (ニコ動・YouTube出身)、Vtuberアーティスト。
例: ヨルシカ, YOASOBI, ずっと真夜中でいいのに。, DECO*27, まふまふ, Ado, kemu, 星街すいせい, 花譜

## idol_female
女性アイドルグループ・ユニット。
例: 乃木坂46, 櫻坂46, 日向坂46, AKB48, =LOVE, モーニング娘。, Perfume, NMB48

## idol_male
男性アイドルグループ・ユニット。ジャニーズ系・新興男性グループ含む。
例: Snow Man, Number_i, BE:FIRST, SixTONES, 嵐, Hey! Say! JUMP, KinKi Kids, KAT-TUN, JO1, INI

## rnb_soul
R&B/ソウル系。
例: 宇多田ヒカル, 三浦大知, Crystal Kay, AI, JUJU, MISIA, 平井堅

## hiphop
ラップ主体。
例: Creepy Nuts, Awich, BAD HOP, RIP SLYME, KICK THE CAN CREW, KREVA, SOUL'd OUT

## enka_kayo
演歌、昭和歌謡、伝統歌謡。
例: 美空ひばり, 氷川きよし, 五木ひろし, 石川さゆり, テレサ・テン, 八代亜紀, 細川たかし

## western
海外アーティスト (英語圏中心)。
例: Taylor Swift, Bruno Mars, Ed Sheeran, Queen, The Beatles, Adele, Maroon 5

## kpop
韓国のアーティスト。
例: BTS, NewJeans, IVE, BLACKPINK, TWICE, LE SSERAFIM, Stray Kids, SEVENTEEN, ITZY

## game_bgm
ゲーム音楽、映画劇伴、インストゥルメンタル。
例: 久石譲, 植松伸夫, すぎやまこういち, 菅野よう子, 下村陽子

## other
上記いずれにも該当しない (童謡、民謡、ネタ曲、校歌等) または不明なアーティスト。

# 出力ルール
- index は入力リストの番号 (1始まり) をそのまま返す
- genres は上記enum値の文字列配列 (最低1つ)
- 不明なアーティストは ["other"]
- 知っているアーティストでも複数ジャンル妥当なら全て付ける (上限なし)`;

// ----------------------------------------------------------------------------
// 構造化出力スキーマ
// ----------------------------------------------------------------------------

const ResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().describe("入力リストの番号 (1始まり)"),
      genres: z
        .array(z.enum(GENRE_CODES))
        .describe("ジャンルコードの配列 (最低1つ)"),
    }),
  ),
});

// ----------------------------------------------------------------------------
// データ取得
// ----------------------------------------------------------------------------

interface ArtistRow {
  id: string;
  name: string;
  song_count: number;
}

async function fetchUnlabeledArtists(): Promise<ArtistRow[]> {
  const supabase = createAdminClient();
  // view と is_labeled は db:types 再生成までクライアント型に乗らないので as キャスト
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const all: ArtistRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("artists_with_song_count")
      .select("id, name, song_count")
      .eq("is_labeled", false)
      .order("song_count", { ascending: false })
      .order("name", { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as ArtistRow[]));
    if (data.length < FETCH_PAGE) break;
    from += FETCH_PAGE;
  }
  return all;
}

// ----------------------------------------------------------------------------
// CLI 引数
// ----------------------------------------------------------------------------

function parseLimit(): number | null {
  const idx = process.argv.findIndex((a) => a === "--limit");
  if (idx === -1) return null;
  const n = Number.parseInt(process.argv[idx + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ----------------------------------------------------------------------------
// メイン
// ----------------------------------------------------------------------------

async function main() {
  const limit = parseLimit();

  let artists = await fetchUnlabeledArtists();
  if (artists.length === 0) {
    console.log("未ラベルのアーティストはありません。");
    return;
  }
  if (limit !== null) {
    artists = artists.slice(0, limit);
    console.log(`--limit ${limit} 指定により ${artists.length} 件に絞り込み`);
  }

  console.log(
    `未ラベル ${artists.length} アーティストをラベリングします (model=${MODEL}, batch=${BATCH_SIZE})\n`,
  );

  const client = new Anthropic();
  const supabase = createAdminClient();

  let labeled = 0;
  let failed = 0;

  for (let i = 0; i < artists.length; i += BATCH_SIZE) {
    const batch = artists.slice(i, i + BATCH_SIZE);
    const listing = batch.map((a, idx) => `${idx + 1}. ${a.name}`).join("\n");

    const range = `${i + 1}-${Math.min(i + BATCH_SIZE, artists.length)}/${artists.length}`;
    console.log(`\n[${range}] バッチ送信中...`);

    let parsed: z.infer<typeof ResponseSchema> | null = null;
    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
        output_config: {
          format: zodOutputFormat(ResponseSchema),
          effort: "medium",
        },
        messages: [
          {
            role: "user",
            content: `以下のアーティストを分類してください。\n\n${listing}`,
          },
        ],
      });
      parsed = response.parsed_output;
      if (!parsed) {
        console.error("  ✗ parsed_output が null");
        failed += batch.length;
        continue;
      }
    } catch (err) {
      console.error(
        `  ✗ API エラー: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed += batch.length;
      continue;
    }

    for (const result of parsed.results) {
      const artist = batch[result.index - 1];
      if (!artist) {
        console.warn(`  ? 未知のindex: ${result.index}`);
        continue;
      }
      const { error: upErr } = await supabase
        .from("artists")
        .update({
          genres: result.genres,
          updated_at: new Date().toISOString(),
        })
        .eq("id", artist.id);
      if (upErr) {
        console.error(`  ✗ ${artist.name}: ${upErr.message}`);
        failed++;
      } else {
        labeled++;
        console.log(
          `  ✓ ${artist.name} (${artist.song_count}曲) → ${result.genres.join(", ")}`,
        );
      }
    }

    // 軽いインターバル (rate limit 回避)
    if (i + BATCH_SIZE < artists.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(`\n=== 完了: 成功 ${labeled} / 失敗 ${failed} ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
