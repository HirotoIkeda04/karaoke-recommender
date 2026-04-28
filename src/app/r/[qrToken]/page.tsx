import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

import { GuestNameForm } from "./guest-name-form";
import { GuestRoomView } from "./guest-room-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ qrToken: string }>;
}

// get_room_state RPC の戻り値型 (db:types 再生成までは jsonb として扱われるため
// クライアント側で as 経由で型を当てる)
interface RoomStateOk {
  status: "ok";
  room_id: string;
  creator_id: string;
  qr_expires_at: string;
  qr_token: string;
  is_creator: boolean;
  is_guest: boolean;
  total_users: number;
  participants: Array<{
    id: string;
    name: string;
    is_user: boolean;
    is_creator: boolean;
  }>;
  repertoire: Array<{
    song_id: string;
    title: string;
    artist: string;
    image_url: string | null;
    singer_ids: string[];
    singer_count: number;
  }>;
}

interface RoomStateError {
  status: "not_found" | "ended" | "unauthorized";
  room_id?: string;
}

type RoomState = RoomStateOk | RoomStateError;

export default async function QrLandingPage({ params }: PageProps) {
  const { qrToken } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ===== 認証ユーザー: 自動 join → /rooms/[id] へリダイレクト =====
  if (user) {
    const { data: joinData, error: joinError } = await supabase.rpc(
      "join_room_by_qr",
      { p_qr_token: qrToken },
    );

    if (joinError) {
      return (
        <ErrorScreen title="参加に失敗" message={joinError.message} />
      );
    }

    const join = joinData?.[0];
    if (!join) {
      return (
        <ErrorScreen
          title="参加に失敗"
          message="RPC のレスポンスが空でした"
        />
      );
    }

    if (
      join.status === "joined_user" ||
      join.status === "rejoined"
    ) {
      if (join.room_id) redirect(`/rooms/${join.room_id}`);
    }

    if (join.status === "expired") {
      return (
        <ErrorScreen
          title="QR の有効期限切れ"
          message="ホストに新しい QR を表示してもらってください"
        />
      );
    }
    if (join.status === "ended") {
      return (
        <ErrorScreen
          title="ルームは終了済み"
          message="このルームは既に終了しています"
        />
      );
    }
    return (
      <ErrorScreen
        title="参加できませんでした"
        message={`status: ${join.status ?? "unknown"}`}
      />
    );
  }

  // ===== ゲスト: cookie の guest_token を確認 =====
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(`guest_token_${qrToken}`)?.value;

  // get_room_state は db:types 再生成までは型未登録のため、
  // supabase オブジェクト全体を any キャストして this バインドを保つ
  // (supabase.rpc を抜き出してキャストすると this を失って実行時エラーになる)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const callGetRoomState = async (
    guestTokenArg: string | null,
  ): Promise<RoomState | null> => {
    const { data } = await sbAny.rpc("get_room_state", {
      p_qr_token: qrToken,
      p_guest_token: guestTokenArg,
    });
    return data as RoomState | null;
  };

  // ゲストで cookie あり: 既存参加レコードを使って状態取得
  if (guestToken) {
    // re-join (left_at をクリア + last_activity_at 更新)
    await supabase.rpc("join_room_by_qr", {
      p_qr_token: qrToken,
      p_guest_token: guestToken,
    });

    const state = await callGetRoomState(guestToken);

    if (state?.status === "ok") {
      return (
        <GuestRoomView
          participants={state.participants}
          repertoire={state.repertoire}
          totalUsers={state.total_users}
        />
      );
    }
    // cookie が古いなど → 名前入力フォームへフォールスルー
  }

  // ゲスト初回: ルームが存在するか先にチェックして creator 名を取得
  const state = await callGetRoomState(null);

  if (state?.status === "not_found") {
    return (
      <ErrorScreen
        title="ルームが見つかりません"
        message="QR が古いか、URL が間違っている可能性があります"
      />
    );
  }
  if (state?.status === "ended") {
    return (
      <ErrorScreen
        title="ルームは終了済み"
        message="このルームは既に終了しています"
      />
    );
  }

  // status が unauthorized であっても (ゲスト初回なので当然)、creator 名を
  // 表示するためにルーム情報だけ別途取りたい。Supabase の RLS は anon SELECT を
  // rooms に対して許可していないため、creator 名は不明として進める。
  // ※ 表示優先度低なので「○○ さんのルーム」の文言は省略し、シンプルに表示。
  return <GuestNameForm qrToken={qrToken} creatorName={null} />;
}

function ErrorScreen({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
        <Link href="/" className="block">
          <Button variant="outline" size="lg" className="w-full">
            ホームに戻る
          </Button>
        </Link>
      </div>
    </main>
  );
}
