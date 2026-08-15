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
 *   検索タブ   ○ タブ   [ 🔍 検索欄 .................... ]
 *
 * くっつく / 離れるの基準は「行き先か、道具か」。評価・ライブラリ・ルームは
 * 行き先なので 1 つのカプセルに入れて相互の関係を見せる。検索はどの画面から
 * でも呼ぶ道具なので、カプセルから外して単独の円ボタンにする。
 *
 * 検索タブに入るとタブのカプセルは 1 つの丸へ畳まれ、空いた幅を検索欄が
 * 占める (App Store と同じ)。丸を押せばタブが戻るので、行き先へは常に
 * 1 タップで到達できる。検索欄まわりの形の変化は AppSearchBar 側。
 */
const TAB_ITEMS = [
  { href: "/", label: "評価", icon: Home },
  { href: "/library", label: "ライブラリ", icon: LibraryBig },
  { href: "/rooms", label: "ルーム", icon: Users },
] as const;

const SEARCH_HREF = "/songs";

export function AppBottomNav() {
  const pathname = usePathname();
  const songSheetSegment = useSelectedLayoutSegment("songSheet");
  const songSheetOpen = isSongSheetOpen(pathname, songSheetSegment);
  const keyboardInset = useKeyboardInset();

  // 検索タブで、畳んだタブバーを一時的に開いている状態。
  // 行き先を選んで移動すれば用は済むので、遷移したら畳み直したい。
  // そこで真偽値ではなく「どのページで開いたか」を持ち、現在地と一致する
  // 間だけ開いているとみなす。これで遷移時に畳む effect が要らなくなる。
  const [expandedAt, setExpandedAt] = useState<string | null>(null);
  const tabsExpanded = expandedAt === pathname;

  // カプセル内タブの現在地。タブ外のページ (/friends, /artists/... 等) では
  // -1 になり、その間はインジケータごと外す。
  const activeIndex = TAB_ITEMS.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  const searchActive = pathname.startsWith(SEARCH_HREF);

  // 検索欄を出すのは検索トップだけ。曲詳細やジャンル一覧では入力欄の
  // 行き場がないので、通常のタブバー (検索を選択状態) に戻す。
  const showSearchBar = pathname === SEARCH_HREF && !tabsExpanded;

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
          <AppSearchBar onExpandTabs={() => setExpandedAt(pathname)} />
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
              onClick={(e) => {
                triggerHaptic();
                // 検索タブでタブを開いている間は、ここが「検索欄に戻る」。
                // 遷移は起きないので自前で畳み直す。
                if (pathname === SEARCH_HREF) {
                  e.preventDefault();
                  setExpandedAt(null);
                }
              }}
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
