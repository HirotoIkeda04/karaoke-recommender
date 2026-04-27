/**
 * Spotify Authorization Code Flow のヘルパ群。
 *
 * - generateState: CSRF 防止用の state 生成
 * - getAuthorizeUrl: Spotify の認可エンドポイント URL 構築
 * - exchangeCodeForTokens: code → access_token / refresh_token 交換
 * - refreshAccessToken: refresh_token で access_token 更新
 * - getSpotifyUser: /me エンドポイントでプロフィール取得
 *
 * 環境変数:
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 *   SPOTIFY_REDIRECT_URI
 */

import { randomBytes } from "node:crypto";

/** ユーザー個別のデータ取得に必要な scope (read-only) */
export const SPOTIFY_USER_SCOPES = [
  "user-top-read", // /me/top/tracks
  "user-read-recently-played", // /me/player/recently-played
  "user-library-read", // /me/tracks (Liked Songs)
] as const;

interface TokenResponse {
  access_token: string;
  /** authorization_code 交換時のみ含まれる */
  refresh_token?: string;
  expires_in: number; // seconds
  scope: string;
  token_type: string;
}

interface SpotifyUser {
  id: string;
  display_name: string | null;
  email?: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("SPOTIFY_CLIENT_ID"),
    response_type: "code",
    redirect_uri: requireEnv("SPOTIFY_REDIRECT_URI"),
    state,
    scope: SPOTIFY_USER_SCOPES.join(" "),
    show_dialog: "false",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function postTokenEndpoint(
  body: Record<string, string>,
): Promise<TokenResponse> {
  const auth = Buffer.from(
    `${requireEnv("SPOTIFY_CLIENT_ID")}:${requireEnv("SPOTIFY_CLIENT_SECRET")}`,
  ).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token endpoint failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<TokenResponse> {
  return postTokenEndpoint({
    grant_type: "authorization_code",
    code,
    redirect_uri: requireEnv("SPOTIFY_REDIRECT_URI"),
  });
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  return postTokenEndpoint({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function getSpotifyUser(
  accessToken: string,
): Promise<SpotifyUser> {
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify /me failed (${res.status}): ${text}`);
  }
  return (await res.json()) as SpotifyUser;
}
