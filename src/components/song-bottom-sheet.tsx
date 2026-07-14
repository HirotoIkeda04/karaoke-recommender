"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion, useDragControls } from "framer-motion";
import { useRouter } from "next/navigation";

import { SongSheetCloseProvider } from "@/components/song-sheet-close-context";
import { SongSheetScrollProvider } from "@/components/song-sheet-scroll-context";

const SHEET_TRANSITION = {
  duration: 0.32,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

export function SongBottomSheet({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  const close = useCallback(() => {
    setClosing(true);
  }, []);

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;

      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        sheetRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === sheetRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [close]);

  return (
    <SongSheetCloseProvider close={close}>
      <SongSheetScrollProvider scrollProgress={scrollProgress}>
      <div className="fixed inset-0 z-40">
        <motion.button
          type="button"
          aria-label="楽曲詳細を閉じる"
          className="absolute inset-0 size-full bg-black/65 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: closing ? 0 : 1 }}
          transition={SHEET_TRANSITION}
          onClick={close}
        />

        <motion.div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="楽曲詳細"
          tabIndex={-1}
          className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[calc(100dvh-2.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-background shadow-[0_-12px_48px_rgba(0,0,0,0.35)] outline-none"
          onKeyDownCapture={(event) => {
            if (
              !expanded &&
              ["ArrowDown", "PageDown", " "].includes(event.key)
            ) {
              event.preventDefault();
              expand();
            }
          }}
          initial={{ y: "100%", height: "65dvh" }}
          animate={{
            y: closing ? "100%" : 0,
            height: expanded ? "calc(100dvh - 2.5rem)" : "65dvh",
          }}
          transition={SHEET_TRANSITION}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.18, bottom: 0.22 }}
          onDragEnd={(_, info) => {
            if (
              !expanded &&
              (info.offset.y < -40 || info.velocity.y < -500)
            ) {
              expand();
              return;
            }
            if (info.offset.y > 90 || info.velocity.y > 700) close();
          }}
          onAnimationComplete={() => {
            if (closing) router.back();
          }}
        >
          <button
            type="button"
            aria-label={
              expanded
                ? "下にスワイプして楽曲詳細を閉じる"
                : "上にスワイプして楽曲詳細を広げる"
            }
            aria-expanded={expanded}
            className="absolute inset-x-0 top-0 z-20 flex h-10 touch-none cursor-grab items-start justify-center bg-gradient-to-b from-black/35 to-transparent pt-3 active:cursor-grabbing"
            onPointerDown={(event) => dragControls.start(event)}
          >
            <span className="h-1 w-10 rounded-full bg-white/55 shadow-sm" />
          </button>
          <div
            ref={contentRef}
            className={`min-h-0 flex-1 overscroll-contain pb-[env(safe-area-inset-bottom)] [--song-detail-leading-padding:0rem] [--song-detail-top-padding:2.5rem] [--song-detail-trailing-padding:2.5rem] ${
              expanded ? "overflow-y-auto" : "overflow-hidden"
            }`}
            onWheel={(event) => {
              if (!expanded && event.deltaY > 0) {
                expand();
              }
            }}
            onScroll={(event) => {
              setScrollProgress(
                Math.min(event.currentTarget.scrollTop / 64, 1),
              );
            }}
            onTouchStart={(event) => {
              touchStartYRef.current = event.touches[0]?.clientY ?? null;
            }}
            onTouchMove={(event) => {
              const startY = touchStartYRef.current;
              const currentY = event.touches[0]?.clientY;
              if (
                !expanded &&
                startY != null &&
                currentY != null &&
                startY - currentY > 12
              ) {
                contentRef.current?.scrollTo({ top: 0 });
                expand();
                touchStartYRef.current = null;
              }
            }}
            onTouchEnd={() => {
              touchStartYRef.current = null;
            }}
          >
            {children}
          </div>
        </motion.div>
      </div>
      </SongSheetScrollProvider>
    </SongSheetCloseProvider>
  );
}
