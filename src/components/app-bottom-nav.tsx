"use client";

import { motion } from "framer-motion";
import { Liquid } from "liquid-gooey";
import { Home, LibraryBig, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { useState } from "react";

import { AppSearchBar } from "@/components/app-search-bar";
import {
  BAR_HEIGHT_PX,
  BAR_HEIGHT_REM,
  BAR_SHADOW,
  GOO_FILL,
  LABEL_PX,
  MOVE_KNOBS,
  MOVE_TRANSITION,
  PILL_H,
  PILL_INSET_X,
  PILL_R,
  SPLIT_GAP_PX,
} from "@/components/bottom-bar-metrics";
import { GlassSurface } from "@/components/ui/glass-surface";
import { triggerHaptic } from "@/lib/haptics";
import { isSongSheetOpen } from "@/lib/song-sheet-route";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";

/**
 * バーの構成は iOS 26 の App Store に倣う。
 *
 *   通常       [ 評価 | ライブラリ | ルーム ]   ○ 検索
 *   検索欄あり  ○ 直前のタブ   [ 🔍 検索欄 ................. ]
 *
 * くっつく / 離れるの基準は「行き先か、道具か」。評価・ライブラリ・ルームは
 * 行き先なので 1 つのカプセルに入れて相互の関係を見せる。検索はどの画面から
 * でも呼ぶ道具なので、カプセルから外して単独の円ボタンにする。
 *
 * 検索欄のあるページではタブのカプセルが 1 つの丸へ畳まれ、空いた幅を
 * 検索欄が占める (App Store と同じ)。畳まれた丸は「直前に開いていたタブ」を
 * 指すので、来た道をそのまま 1 タップで戻れる。検索欄まわりの形の変化と
 * 液体でのくっつき / 分離は AppSearchBar 側。
 */
export const TAB_ITEMS = [
  { href: "/", label: "評価", icon: Home },
  { href: "/library", label: "ライブラリ", icon: LibraryBig },
  { href: "/rooms", label: "ルーム", icon: Users },
] as const;

export type TabItem = (typeof TAB_ITEMS)[number];

const SEARCH_HREF = "/songs";

/**
 * 検索欄を下部バーに出すページと、その placeholder。
 *
 * 「検索タブだけ」と決め打ちにせず表にしてあるのは、他のタブにも検索欄を
 * 足したくなったときにここへ 1 行足すだけで済むようにするため。
 * pathname の完全一致で引く (配下の詳細ページには出さない)。
 */
const SEARCH_FIELD_PAGES: Record<string, { placeholder: string }> = {
  [SEARCH_HREF]: { placeholder: "楽曲・アーティストを検索" },
};

export function AppBottomNav() {
  const pathname = usePathname();
  const songSheetSegment = useSelectedLayoutSegment("songSheet");
  const songSheetOpen = isSongSheetOpen(pathname, songSheetSegment);
  const keyboardInset = useKeyboardInset();

  // カプセル内タブの現在地。タブ外のページ (/friends, /artists/... 等) では
  // -1 になり、その間はインジケータごと外す。
  const activeIndex = TAB_ITEMS.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  const searchActive = pathname.startsWith(SEARCH_HREF);

  // 検索欄を出すのはページ単位。曲詳細やジャンル一覧では入力欄の行き場が
  // ないので、通常のタブバー (検索を選択状態) に戻る。
  const searchField = SEARCH_FIELD_PAGES[pathname];
  const showSearchBar = searchField != null;

  // 検索欄のページでは行き先タブのカプセルが 1 つの丸に畳まれる。その丸が
  // 指すのは「検索欄に入る直前に開いていたタブ」。固定でホームにすると、
  // ライブラリから検索に来た人がホーム経由で戻る羽目になる。
  //
  // effect ではなく描画中に前回値と比べて更新する (React 公式の
  // 「props 変化に合わせて state を調整する」形)。effect にすると
  // 遷移のたびに再レンダリングが 1 往復増える。
  const [tabMemo, setTabMemo] = useState({
    at: pathname,
    href: TAB_ITEMS[0].href as string,
  });
  if (tabMemo.at !== pathname) {
    setTabMemo({
      at: pathname,
      // 検索欄のページ自体はタブでも「戻り先」にはしない (自分自身に戻る
      // ボタンになってしまう)。それ以外のタブに居たときだけ控える。
      href:
        activeIndex >= 0 && !showSearchBar
          ? TAB_ITEMS[activeIndex].href
          : tabMemo.href,
    });
  }
  const backTab =
    TAB_ITEMS.find((item) => item.href === tabMemo.href) ?? TAB_ITEMS[0];

  // キーボードはレイアウトビューポートを変えないので、fixed のこのバーは
  // 放っておくとキーボードの裏に入る。覆われた分だけ自力で持ち上げる。
  const lift = showSearchBar ? keyboardInset : 0;

  return (
    <motion.nav
      // 画面幅いっぱいの帯ではなく、左右と下端から浮かせたカプセルにする
      // (iOS 26 のタブバー)。背後のコンテンツがバーの周りに見えることで
      // 初めてガラスがガラスとして読めるので、この余白は装飾ではなく必須。
      className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4"
      initial={false}
      animate={{ y: songSheetOpen ? "150%" : -lift }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      aria-hidden={songSheetOpen}
      style={{
        // ホームインジケータの上に載せる。safe-area が無い端末でも最低
        // 0.75rem は浮かせて、画面下端に貼り付いて見えないようにする。
        // キーボードが出ている間はホームインジケータもキーボードの裏なので、
        // safe-area ぶんの余白は無駄な隙間にしかならず、詰める。
        paddingBottom: lift > 0
          ? "0.75rem"
          : "max(0.75rem, env(safe-area-inset-bottom))",
      }}
    >
      <div
        className="pointer-events-auto mx-auto flex max-w-md items-center"
        style={{ height: `${BAR_HEIGHT_REM}rem` }}
      >
        {showSearchBar ? (
          <AppSearchBar
            backTab={backTab}
            placeholder={searchField.placeholder}
          />
        ) : (
          <>
            {/* ── 行き先のタブ (くっつく側) ───────────────────── */}
            <div
              className="relative h-full flex-1 rounded-full"
              style={{ boxShadow: BAR_SHADOW }}
            >
              {/* カプセル全面のすりガラス (@samasante の material モード)。
                  背後をぼかす土台で、この上に液体レイヤーとタブが乗る。 */}
              <GlassSurface variant="bar" radius={9999} />

              {/* 液体グループ。シルエットは SVG で children の背面に描かれ、
                  アイコンは一切フィルタされないのでクリスプなまま残る。 */}
              <Liquid
                blur={8}
                contrast={20}
                fill={GOO_FILL}
                filterPadding={40}
                style={{ position: "relative", height: "100%" }}
              >
                {activeIndex >= 0 ? (
                  <Liquid.Item effect="move" move={MOVE_KNOBS}>
                    {/* 中身は透明。見えているのは液体シルエットだけ。
                        自分は CSS transition で動き、液体がバネで遅れて追う。 */}
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        top: (BAR_HEIGHT_PX - PILL_H) / 2,
                        left: PILL_INSET_X,
                        width: `calc(${100 / TAB_ITEMS.length}% - ${PILL_INSET_X * 2}px)`,
                        height: PILL_H,
                        borderRadius: PILL_R,
                        // translateX の % は「自分の幅」基準なので、左右の逃げを
                        // 足し戻さないと 1 タブ分ぴったりにならない。
                        //   自分の幅 = (100/n)% - 2I → (100% + 2I) = 1 タブ分
                        transform: `translateX(calc(${activeIndex} * (100% + ${PILL_INSET_X * 2}px)))`,
                        transition: MOVE_TRANSITION,
                      }}
                    />
                  </Liquid.Item>
                ) : null}

                {/* grid で 3 タブを必ず等分。各タブの中心がカプセル幅の
                    1/6, 3/6, 5/6 に固定される (= インジケータの刻みと一致)。
                    ※ プロフィール (旧「音域」タブ) は /library に集約。
                      フレンド管理は /library のプロフィール内リンクから /friends へ。 */}
                <ul className="grid h-full grid-cols-3 items-center">
                  {TAB_ITEMS.map((item, i) => {
                    const Icon = item.icon;
                    const active = i === activeIndex;
                    return (
                      <li key={item.href} className="min-w-0">
                        {/* ラベルが見えているので aria-label は付けない
                            (付けるとスクリーンリーダーがラベルを二重に読む)。 */}
                        <Link
                          href={item.href}
                          // triggerHaptic(durationMs = 15) なので、そのまま渡すと
                          // MouseEvent が durationMs に入る。必ず包むこと。
                          onClick={() => triggerHaptic()}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex w-full flex-col items-center justify-center gap-[3px] px-1",
                            active ? "text-white" : "text-zinc-400",
                          )}
                        >
                          <Icon className="size-6" aria-hidden />
                          <span
                            className="max-w-full truncate text-[10px] font-medium"
                            style={{ lineHeight: `${LABEL_PX}px` }}
                          >
                            {item.label}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Liquid>
            </div>

            {/* ── 検索 (離れる側) ─────────────────────────────
                App Store と同じくラベルを持たない単独の円ボタン。
                カプセルの外なので液体インジケータは届かず、現在地の表現は
                自前の明るいレイヤーで行う。 */}
            <Link
              href={SEARCH_HREF}
              onClick={() => triggerHaptic()}
              aria-label="検索"
              aria-current={searchActive ? "page" : undefined}
              className={cn(
                "relative flex shrink-0 items-center justify-center rounded-full",
                searchActive ? "text-white" : "text-zinc-400",
              )}
              style={{
                width: BAR_HEIGHT_PX,
                height: BAR_HEIGHT_PX,
                marginLeft: SPLIT_GAP_PX,
                boxShadow: BAR_SHADOW,
              }}
            >
              <GlassSurface variant="bar" radius={9999} />
              {searchActive ? (
                // カプセル内のインジケータと同じ塗り・同じ逃げ幅にして、
                // 外周にガラスの縁が残るようにする (全面を塗るとガラスが消える)。
                <span
                  aria-hidden
                  className="absolute rounded-full"
                  style={{ inset: PILL_INSET_X, background: GOO_FILL }}
                />
              ) : null}
              <Search className="relative size-6" aria-hidden />
            </Link>
          </>
        )}
      </div>
    </motion.nav>
  );
}
