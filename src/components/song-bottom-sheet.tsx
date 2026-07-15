"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  motion,
  useAnimationControls,
  useDragControls,
} from "framer-motion";
import { useRouter } from "next/navigation";

import { SongSheetCloseProvider } from "@/components/song-sheet-close-context";
import { SongSheetScrollProvider } from "@/components/song-sheet-scroll-context";

const SHEET_TRANSITION = {
  duration: 0.32,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

const SCROLL_HANDOFF_DISTANCE = 8;
const COLLAPSE_DISTANCE = 56;
const COLLAPSE_VELOCITY = 500;
const CLOSE_DISTANCE_RATIO = 0.35;

function findTouch(touches: TouchList, identifier: number) {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) return touch;
  }
  return null;
}

export function SongBottomSheet({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const animationControls = useAnimationControls();
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draggingSheet, setDraggingSheet] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const collapsedOffset = viewportHeight * 0.25;

  const close = useCallback(() => {
    setClosing(true);
  }, []);

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  useEffect(() => {
    const updateViewportHeight = () => {
      setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
    };

    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("resize", updateViewportHeight);

    return () => {
      window.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
    };
  }, []);

  useEffect(() => {
    if (viewportHeight === 0) return;

    void animationControls.start({
      y: closing ? viewportHeight : expanded ? 0 : collapsedOffset,
      transition: SHEET_TRANSITION,
    });
  }, [
    animationControls,
    closing,
    collapsedOffset,
    expanded,
    viewportHeight,
  ]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !expanded) return;

    let gesture: {
      identifier: number;
      handoffX: number;
      handoffY: number | null;
      lastY: number;
      lastTimestamp: number;
      velocityY: number;
      dragY: number;
      draggingSheet: boolean;
    } | null = null;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        gesture = null;
        return;
      }

      const touch = event.touches.item(0);
      if (!touch) return;

      gesture = {
        identifier: touch.identifier,
        handoffX: touch.clientX,
        handoffY: content.scrollTop <= 0 ? touch.clientY : null,
        lastY: touch.clientY,
        lastTimestamp: event.timeStamp,
        velocityY: 0,
        dragY: 0,
        draggingSheet: false,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!gesture) return;

      const touch = findTouch(event.touches, gesture.identifier);
      if (!touch) return;

      const elapsed = Math.max(event.timeStamp - gesture.lastTimestamp, 1);
      gesture.velocityY = ((touch.clientY - gesture.lastY) / elapsed) * 1000;
      gesture.lastY = touch.clientY;
      gesture.lastTimestamp = event.timeStamp;

      if (!gesture.draggingSheet && content.scrollTop > 0) {
        gesture.handoffY = null;
        return;
      }

      if (gesture.handoffY === null) {
        gesture.handoffX = touch.clientX;
        gesture.handoffY = touch.clientY;
        return;
      }

      const deltaX = touch.clientX - gesture.handoffX;
      const deltaY = touch.clientY - gesture.handoffY;

      if (!gesture.draggingSheet) {
        if (
          deltaY <= SCROLL_HANDOFF_DISTANCE ||
          deltaY <= Math.abs(deltaX)
        ) {
          return;
        }
        gesture.draggingSheet = true;
        setDraggingSheet(true);
      }

      event.preventDefault();
      gesture.dragY = Math.min(Math.max(deltaY, 0), viewportHeight);
      animationControls.set({ y: gesture.dragY });
    };

    const finishTouch = (event: TouchEvent, cancelled = false) => {
      if (!gesture) return;

      if (gesture.draggingSheet) {
        event.preventDefault();
        setDraggingSheet(false);
        if (event.timeStamp - gesture.lastTimestamp > 100) {
          gesture.velocityY = 0;
        }
        const shouldClose =
          !cancelled &&
          gesture.dragY >= viewportHeight * CLOSE_DISTANCE_RATIO;
        const shouldCollapse =
          !cancelled &&
          (gesture.dragY >= COLLAPSE_DISTANCE ||
            gesture.velocityY >= COLLAPSE_VELOCITY);

        if (shouldClose) {
          close();
        } else if (shouldCollapse) {
          setExpanded(false);
        } else {
          void animationControls.start({
            y: 0,
            transition: SHEET_TRANSITION,
          });
        }
      }

      gesture = null;
    };

    const onTouchEnd = (event: TouchEvent) => finishTouch(event);
    const onTouchCancel = (event: TouchEvent) => finishTouch(event, true);

    content.addEventListener("touchstart", onTouchStart, { passive: true });
    content.addEventListener("touchmove", onTouchMove, { passive: false });
    content.addEventListener("touchend", onTouchEnd, { passive: false });
    content.addEventListener("touchcancel", onTouchCancel, { passive: false });

    return () => {
      content.removeEventListener("touchstart", onTouchStart);
      content.removeEventListener("touchmove", onTouchMove);
      content.removeEventListener("touchend", onTouchEnd);
      content.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [animationControls, close, expanded, viewportHeight]);

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
      <SongSheetScrollProvider
        scrollProgress={expanded && !draggingSheet ? scrollProgress : 0}
      >
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
          className="absolute inset-x-0 bottom-0 mx-auto flex h-[90dvh] max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-background shadow-[0_-12px_48px_rgba(0,0,0,0.35)] outline-none"
          onKeyDownCapture={(event) => {
            if (
              !expanded &&
              ["ArrowDown", "PageDown", " "].includes(event.key)
            ) {
              event.preventDefault();
              expand();
            }
          }}
          initial={{ y: "100%" }}
          animate={animationControls}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: viewportHeight }}
          dragElastic={{ top: 0.04, bottom: 0 }}
          dragMomentum={false}
          onDragStart={() => setDraggingSheet(true)}
          onDragEnd={(_, info) => {
            setDraggingSheet(false);
            if (info.offset.y > 90 || info.velocity.y > 700) {
              close();
              return;
            }
            if (!expanded && (info.offset.y < -16 || info.velocity.y < -200)) {
              expand();
              return;
            }

            void animationControls.start({
              y: expanded ? 0 : collapsedOffset,
              transition: SHEET_TRANSITION,
            });
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
              expanded ? "overflow-y-auto" : "touch-none overflow-hidden"
            }`}
            onPointerDown={(event) => {
              if (!expanded) dragControls.start(event);
            }}
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
          >
            {children}
          </div>
        </motion.div>
      </div>
      </SongSheetScrollProvider>
    </SongSheetCloseProvider>
  );
}
