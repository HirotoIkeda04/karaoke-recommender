import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Google OAuth リダイレクト先。
 * Supabase が `?code=...` を付与してくるので、これをセッションに交換する。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("認可コードが返されませんでした")}`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // 仮 display_name のままなら /profile/setup へ誘導
  // (handle_new_user トリガが "ユーザー XXXX" の形式で初期値を入れる)
  if (data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", data.user.id)
      .maybeSingle();

    if (
      profile?.display_name &&
      /^ユーザー [0-9A-F]{4}$/.test(profile.display_name)
    ) {
      const setupUrl = new URL("/profile/setup", origin);
      setupUrl.searchParams.set("next", next);
      return NextResponse.redirect(setupUrl.toString());
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
