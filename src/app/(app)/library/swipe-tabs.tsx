"use client";

import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";

interface Props {
  prevHref: string | null;
  nextHref: string | null;
  children: ReactNode;
}

const SWIPE_DISTANCE_PX = 60;

export function SwipeTabs({ prevHref, nextHref, children }: Props) {
  const router = useRouter();
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  return (
    <div
      onTouchStart={(e) => {
        const t = e.touches[0];
        startX.current = t.clientX;
        startY.current = t.clientY;
      }}
      onTouchEnd={(e) => {
        const sx = startX.current;
        const sy = startY.current;
        startX.current = null;
        startY.current = null;
        if (sx == null || sy == null) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;
        if (Math.abs(dx) < SWIPE_DISTANCE_PX) return;
        if (Math.abs(dy) > Math.abs(dx)) return;
        if (dx < 0 && nextHref) router.push(nextHref);
        else if (dx > 0 && prevHref) router.push(prevHref);
      }}
    >
      {children}
    </div>
  );
}
