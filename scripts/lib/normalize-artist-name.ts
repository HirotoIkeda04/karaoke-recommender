/**
 * artists.name_norm (名寄せキー / UNIQUE) を計算する唯一の TS 実装。
 *
 * SQL 側 `public.normalize_artist_name` (migrations/061) と 1 対 1 で対応する。
 * 片方だけ直すと「SQL では同一 / TS では別」の行が生まれ、UNIQUE を素通りした
 * 重複アーティストになる。実際に 2026-08-24 の調査では、スクリプト側が独自の
 * 緩い normalize (NFKC + lower + 空白除去のみ) を name_norm に書いていたため、
 *   五木ひろし･木の実ナナ / 五木ひろし/木の実ナナ
 * のような「区切り文字違いだけ」の重複が 7 組できていた。
 *
 * name_norm を書く箇所は必ずこの関数を通すこと。曖昧マッチ用の緩いキーが
 * 欲しい場合は各スクリプト内のローカル関数を使い、name_norm には使わない。
 */

/**
 * migrations/061_normalize_artist_name_symbols.sql の
 * `public.normalize_artist_name` と同等。
 *
 * NFKC 正規化 → 小文字化 → 空白・区切り記号・括弧類の除去。
 * NFKC が畳む文字 (･ → ・ / ～ → ~) も、NFKC を通していない入力に備えて
 * 記号クラスへ明示的に含めてある。
 */
export function normalizeArtistName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.\-_,!?'"・･/\\()（）「」『』【】~〜]+/g, "");
}
