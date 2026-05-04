import Image, { type ImageProps } from "next/image";

/**
 * Spotify / iTunes 等の外部 CDN 画像用ラッパー。
 *
 * `unoptimized` で `/_next/image` を経由せず、ブラウザが CDN を直接 fetch する。
 * 用途: 楽曲ジャケット / アーティスト画像 (どちらも i.scdn.co や mzstatic.com 由来)。
 *
 * 経緯:
 *   2026-05 に Vercel の Image Transformations クォータ (5,000/月) を超過したため、
 *   外部 CDN 由来の画像については最適化をバイパスする方針とした。
 *   元 CDN は既に適切なサイズ (640px JPEG 等) で配信しており、最適化スキップによる
 *   体感品質の劣化はほぼ無視できる。詳細は 2026-05-04 のセッションログを参照。
 *
 * 切り戻し:
 *   将来 Vercel Pro 等にアップグレードし transformations 上限が増えた場合は、
 *   この `unoptimized` を外す (本ファイル 1 箇所のみ修正で全体に反映される)。
 */
export function JacketImage(props: ImageProps) {
  return <Image {...props} unoptimized />;
}
