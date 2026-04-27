/**
 * Spotify Web API クライアント。
 *
 * - getValidAccessToken: DB から token を取得、期限切れなら refresh して保存
 * - spotifyGet: GET リクエスト共通ヘルパ
 *
 * トークンは DB に AES-256-GCM 暗号化された状態で格納されている。
 * このモジュール内でのみ復号して使用、再保存時は再暗号化する。
 */

import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/spotify/oauth";
import { createClient } from "@/lib/supabase/server";

/**
 * 有効な access_token を返す。期限切れなら refresh + DB 更新。
 * 失効までの時間に 60 秒のバッファを設けて、リクエスト中に期限切れになる事故を防ぐ。
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_spotify_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("Spotify not connected for this user");
  }

  const accessToken = decrypt(data.access_token);
  const expiresAt = new Date(data.expires_at);
  const buffer = 60 * 1000; // 60 秒
  if (expiresAt.getTime() > Date.now() + buffer) {
    return accessToken;
  }

  // refresh
  const refreshToken = decrypt(data.refresh_token);
  const tokens = await refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(
    Date.now() + tokens.expires_in * 1000,
  ).toISOString();

  // refresh response に refresh_token が含まれる場合は更新、無ければ既存維持
  const newRefreshToken = tokens.refresh_token
    ? encrypt(tokens.refresh_token)
    : data.refresh_token;

  await supabase
    .from("user_spotify_connections")
    .update({
      access_token: encrypt(tokens.access_token),
      refresh_token: newRefreshToken,
      expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  return tokens.access_token;
}

/**
 * Spotify Web API への GET リクエスト共通ラッパ。
 */
export async function spotifyGet<T>(
  accessToken: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`https://api.spotify.com/v1${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Spotify GET ${path} failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}
