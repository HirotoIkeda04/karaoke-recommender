import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

function settingsUrl(origin: string, key: "linked" | "error", value: string) {
  const url = new URL("/settings/account", origin);
  url.searchParams.set(key, value);
  return url;
}

function loginUrl(origin: string, error: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("next", "/settings/account");
  url.searchParams.set("error", error);
  return url;
}

/**
 * ログイン中のKyokuMokuアカウントへGoogle identityを追加するPKCEコールバック。
 * 通常ログインのコールバックと分離し、別ユーザーへのセッション切替を防ぐ。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError =
    searchParams.get("error_description") ?? searchParams.get("error");
  const supabase = await createClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return NextResponse.redirect(
      loginUrl(origin, "リンクを追加するには再度ログインしてください"),
    );
  }

  if (oauthError) {
    return NextResponse.redirect(settingsUrl(origin, "error", oauthError));
  }

  if (!code) {
    return NextResponse.redirect(
      settingsUrl(origin, "error", "認可コードが返されませんでした"),
    );
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      settingsUrl(origin, "error", error.message),
    );
  }

  if (!data.user || data.user.id !== currentUser.id) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      settingsUrl(
        origin,
        "error",
        "安全のため処理を中止しました。もう一度ログインしてお試しください",
      ),
    );
  }

  return NextResponse.redirect(settingsUrl(origin, "linked", "1"));
}
