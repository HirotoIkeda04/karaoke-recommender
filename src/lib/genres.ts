// ジャンル定義 (migrations/011_artists_and_genres.sql の CHECK 制約と同期)
//
// 追加・変更時の手順:
//   1. ここの GENRE_CODES / GENRE_LABELS を更新
//   2. DB 側の CHECK 制約を更新するマイグレーションを作成
//   3. pnpm db:types で型再生成

export const GENRE_CODES = [
  "j_pop",
  "j_rock",
  "anison",
  "vocaloid_utaite",
  "idol_female",
  "idol_male",
  "rnb_soul",
  "hiphop",
  "enka_kayo",
  "western",
  "kpop",
  "game_bgm",
  "other",
] as const;

export type GenreCode = (typeof GENRE_CODES)[number];

export const GENRE_LABELS: Record<GenreCode, string> = {
  j_pop: "J-POP",
  j_rock: "邦ロック",
  anison: "アニソン",
  vocaloid_utaite: "ボカロ・歌い手",
  idol_female: "女性アイドル",
  idol_male: "男性アイドル",
  rnb_soul: "R&B・ソウル",
  hiphop: "HipHop",
  enka_kayo: "演歌・歌謡曲",
  western: "洋楽",
  kpop: "K-POP",
  game_bgm: "ゲーム・劇伴",
  other: "その他",
};

export function isGenreCode(value: string): value is GenreCode {
  return (GENRE_CODES as readonly string[]).includes(value);
}
