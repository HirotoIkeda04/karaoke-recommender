import Link from "next/link";
import { ChevronRight, Star } from "lucide-react";

import { resolveIconColor } from "@/lib/icon-color";
import { RoomDateLabel } from "./room-date-label";

export interface HistoryCardParticipant {
  userId: string | null;
  name: string;
  iconColor: string | null;
  isSelf: boolean;
}

export interface HistoryCardProps {
  roomId: string;
  createdAt: string;
  ended: boolean;
  isRecurring: boolean;
  participantCount: number;
  // 全参加者 (自分含む)。先頭が自分なのでアバターも自分始まりで描画する。
  participants: HistoryCardParticipant[];
}

function firstGrapheme(name: string): string {
  if (!name) return "?";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter("ja", { granularity: "grapheme" });
    const first = seg.segment(name)[Symbol.iterator]().next().value;
    if (first?.segment) return first.segment.toUpperCase();
  }
  return name.charAt(0).toUpperCase();
}

function AvatarStack({
  participants,
  max = 4,
}: {
  participants: HistoryCardParticipant[];
  max?: number;
}) {
  const visible = participants.slice(0, max);
  const overflow = participants.length - visible.length;
  return (
    <div className="flex shrink-0 -space-x-1.5">
      {visible.map((p, i) => {
        const color = p.userId
          ? resolveIconColor(p.iconColor)
          : "#71717a"; // ゲストは zinc グレー
        const label = p.isSelf ? `${p.name} (自分)` : p.name;
        return (
          <span
            key={i}
            className="flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white dark:ring-zinc-900"
            style={{ backgroundColor: color }}
            title={label}
            aria-label={label}
          >
            {firstGrapheme(p.name)}
          </span>
        );
      })}
      {overflow > 0 ? (
        <span className="flex size-7 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-700 ring-2 ring-white dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-900">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

export function RoomHistoryCard({
  roomId,
  createdAt,
  ended,
  isRecurring,
  participantCount,
  participants,
}: HistoryCardProps) {
  return (
    <Link
      href={`/rooms/${roomId}`}
      className={
        isRecurring
          ? "block rounded-2xl border border-amber-200 bg-amber-50/50 p-3 transition hover:bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/15 dark:hover:bg-amber-950/30"
          : "block rounded-2xl border border-zinc-200 bg-white p-3 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/50"
      }
    >
      <div className="flex items-center gap-3">
        {participants.length > 0 ? (
          <AvatarStack participants={participants} />
        ) : null}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            {isRecurring ? (
              <Star
                className="size-3.5 shrink-0 fill-amber-500 text-amber-500"
                aria-label="いつものルーム"
              />
            ) : null}
            {!ended && !isRecurring ? (
              <span
                className="size-2 shrink-0 rounded-full bg-emerald-500"
                aria-label="進行中"
              />
            ) : null}
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
              <RoomDateLabel createdAt={createdAt} />
            </p>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            {participantCount}人{!ended ? " ・進行中" : ""}
          </p>
        </div>
        <ChevronRight
          className="size-4 shrink-0 text-zinc-400 dark:text-zinc-600"
          aria-hidden
        />
      </div>
    </Link>
  );
}
