"use client";

import { useEffect, useState } from "react";

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

function formatRoomDate(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  if (day.getTime() === today.getTime()) return `今日 ${time}`;
  if (day.getTime() === yesterday.getTime()) return `昨日 ${time}`;

  const wd = WEEKDAYS_JA[date.getDay()];
  const md = `${date.getMonth() + 1}/${date.getDate()}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${md} (${wd}) ${time}`;
  }
  return `${date.getFullYear()}/${md} (${wd}) ${time}`;
}

// サーバーは UTC で動くので、ユーザーのローカルタイムゾーンで描画するために
// マウント後に一度だけ再計算する。初期 SSR 出力はプレースホルダ。
export function RoomDateLabel({ createdAt }: { createdAt: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(formatRoomDate(new Date(createdAt)));
  }, [createdAt]);

  return (
    <span suppressHydrationWarning>
      {label ?? " "}
    </span>
  );
}
