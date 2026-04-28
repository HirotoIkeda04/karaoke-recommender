import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";

import { createClient } from "@/lib/supabase/server";

import { QrSection } from "./qr-section";
import {
  RepertoireList,
  type RepertoireItem,
} from "./repertoire-list";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ParticipantView {
  participantId: string;
  name: string;
  isUser: boolean;
  isCreator: boolean;
}

export default async function RoomPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // ルーム取得 (RLS で参加者・creator のみ閲覧可)
  const { data: room } = await supabase
    .from("rooms")
    .select("id, creator_id, qr_token, qr_expires_at, ended_at, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!room) notFound();

  // 参加者取得 (RLS で同じルームの参加者・creator のみ閲覧可)
  const { data: participantsRaw } = await supabase
    .from("room_participants")
    .select("id, user_id, guest_name, joined_at, left_at")
    .eq("room_id", id)
    .is("left_at", null);

  const userIds = (participantsRaw ?? [])
    .map((p) => p.user_id)
    .filter((u): u is string => u !== null);

  const profileMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p.display_name);
    }
  }

  const participants: ParticipantView[] = (participantsRaw ?? []).map((p) => ({
    participantId: p.id,
    name: p.user_id
      ? (profileMap.get(p.user_id) ?? "(不明なユーザー)")
      : (p.guest_name ?? "ゲスト"),
    isUser: p.user_id !== null,
    isCreator: p.user_id === room.creator_id,
  }));

  // === マージ済レパートリー ===
  // 認証ユーザー参加者の easy/medium 評価を集計
  const repertoire: RepertoireItem[] = [];
  if (userIds.length > 0) {
    const { data: evals } = await supabase
      .from("evaluations")
      .select(
        "user_id, song_id, rating, songs(id, title, artist, image_url_medium)",
      )
      .in("user_id", userIds)
      .in("rating", ["easy", "medium"]);

    const songMap = new Map<string, RepertoireItem>();
    for (const e of evals ?? []) {
      if (!e.songs) continue;
      const existing = songMap.get(e.song_id);
      if (existing) {
        if (!existing.singerIds.includes(e.user_id)) {
          existing.singerIds.push(e.user_id);
        }
      } else {
        songMap.set(e.song_id, {
          songId: e.song_id,
          title: e.songs.title,
          artist: e.songs.artist,
          imageUrl: e.songs.image_url_medium,
          singerIds: [e.user_id],
        });
      }
    }
    repertoire.push(
      ...Array.from(songMap.values()).sort(
        (a, b) => b.singerIds.length - a.singerIds.length,
      ),
    );
  }

  // === QR URL 生成 (リクエストヘッダから origin を組み立て) ===
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const proto =
    headersList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const qrUrl = `${proto}://${host}/r/${room.qr_token}`;

  // QR を SVG として生成 (margin=1 で余白最小)
  const qrSvg = await QRCode.toString(qrUrl, {
    type: "svg",
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
  });

  const isCreator = room.creator_id === user.id;
  const profileMapObj = Object.fromEntries(profileMap.entries());

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <h1 className="text-lg font-semibold">カラオケルーム</h1>

      <QrSection
        url={qrUrl}
        qrSvg={qrSvg}
        expiresAt={room.qr_expires_at}
        roomId={room.id}
        isCreator={isCreator}
        ended={room.ended_at !== null}
      />

      <ParticipantsSection participants={participants} />

      <RepertoireList
        repertoire={repertoire}
        totalUserParticipants={userIds.length}
        profileMap={profileMapObj}
      />
    </div>
  );
}

function ParticipantsSection({
  participants,
}: {
  participants: ParticipantView[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        参加者 ({participants.length})
      </h2>
      <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {participants.map((p) => (
          <li
            key={p.participantId}
            className="flex items-center gap-2 px-4 py-3"
          >
            <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {p.name}
            </span>
            {p.isCreator ? (
              <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-medium text-pink-700 dark:bg-pink-950 dark:text-pink-300">
                作成者
              </span>
            ) : null}
            {!p.isUser ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                ゲスト
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
