"use client";

import { motion } from "framer-motion";
import { Liquid } from "liquid-gooey";
import { Home, LibraryBig, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";

import { GlassSurface } from "@/components/ui/glass-surface";
import { triggerHaptic } from "@/lib/haptics";
import { isSongSheetOpen } from "@/lib/song-sheet-route";
import { cn } from "@/lib/utils";

/**
 * バーの構成は iOS 26 の App Store に倣う。
 *
 *   [ 評価 | ライブラリ | ルーム ]   ○ 検索
 *   └── 行き先のタブは 1 つのカプセル ┘  └ 検索だけ独立した円ボタン ┘
 *
 * くっつく / 離れるの基準は「行き先か、道具か」。評価・ライブラリ・ルームは
 * 行き先なので 1 つのカプセルに入れて相互の関係を見せる。検索はどの画面から
 * でも呼ぶ道具なので、カプセルから外して単独の円ボタンにする。
 * App Store も Today/ゲーム/アプリ/Arcade がカプセル、検索だけ独立している。
 *
 * 検索がカプセルの外にいるので、選択インジケータ (液体) が動くのは
 * カプセル内の 3 タブの間だけ。検索が現在地のときは円ボタン側が明るくなる。
 */
const TAB_ITEMS = [
  { href: "/", label: "評価", icon: Home },
  { href: "/library", label: "ライブラリ", icon: LibraryBig },
  { href: "/rooms", label: "ルーム", icon: Users },
] as const;

const SEARCH_HREF = "/songs";

/**
 * バーの実高 (px)。画面下端との間隔と合わせて (app)/layout.tsx の main の
 * bottom padding、および record-deck / loading の縦予算に効く。
 * 独立した検索ボタンの直径もこれに合わせる (App Store もカプセルの高さと
 * 円の直径が同じ)。
 */
const BAR_HEIGHT_REM = 4;
const BAR_HEIGHT_PX = BAR_HEIGHT_REM * 16;

/** カプセルと検索ボタンの間隔。ここが「離れている」ことの表現そのもの。 */
const SPLIT_GAP_PX = 8;

/**
 * タブ 1 つ分の中身の寸法。「アイコン + その下にラベル」の 2 段。
 * 24 + 3 + 12 = 39px なのでバー高さ 4rem (64px) に収まり、
 * record-deck / loading の縦予算 (DISC_SIZE) を触らずに済む。
 *
 * アイコンを円チップに載せる案は一度試して取りやめた。Luma のチップは
 * サイズ・明度・アイコンとの余白が精妙で、雑に寄せると再現度が低いまま
 * 要素だけ増えて悪化する。素のアイコンのほうがまだ良い。
 */
const LABEL_PX = 12;

/**
 * 選択インジケータ (液体の塊) の寸法。アイコンとラベルをまとめて包む。
 *
 * 角丸はバーと同心になるように決める。バーは rounded-full なので角丸は
 * 高さの半分 = 32px。インジケータは上下 (64-48)/2 = 8px 内側に入るので、
 * 同心の角丸は 32 - 8 = 24px。ここを小さくすると、カプセルの中で
 * インジケータだけ角張って見える (18px だった頃がまさにそれ)。
 * 48/2 = 24 なので結果的にバーと同じカプセル形になり、形の語彙も揃う。
 *
 * 左右の逃げは、両端のタブでインジケータがバーの丸い先端とぶつからない
 * ようにするため。角丸 24 と合わせると端のタブでも内側に収まる。
 */
const PILL_H = 48;
const PILL_R = 24;
const PILL_INSET_X = 6;

/** インジケータの移動時間。goo のバネはこれを追いかけて尾を引く。 */
const MOVE_TRANSITION = "transform .52s cubic-bezier(.34,1.36,.42,1)";

/**
 * goo の塗り。必ず不透明色にすること。
 * goo フィルタは alpha' = contrast*a - offset (既定 20a - 7.83) でアルファを
 * 切り直すため、半透明色を渡すと alpha' が負に振り切れてシルエットが丸ごと
 * 消える。透け感は色そのもので作る。
 * #3f3f42 は iOS の systemGray4 (#3a3a3c) を一段明るくした値で、
 * Luma のアクティブ矩形と同じくらいバーから浮いて見える。
 */
const GOO_FILL = "#3f3f42";

export function AppBottomNav() {
  const pathname = usePathname();
  const songSheetSegment = useSelectedLayoutSegment("songSheet");
  const songSheetOpen = isSongSheetOpen(pathname, songSheetSegment);

  // カプセル内タブの現在地。タブ外のページ (/friends, /artists/... 等) では
  // -1 になり、その間はインジケータごと外す。
  const activeIndex = TAB_ITEMS.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  const searchActive = pathname.startsWith(SEARCH_HREF);

  return (
    <motion.nav
      // 画面幅いっぱいの帯ではなく、左右と下端から浮かせたカプセルにする
      // (iOS 26 のタブバー)。背後のコンテンツがバーの周りに見えることで
      // 初めてガラスがガラスとして読めるので、この余白は装飾ではなく必須。
      className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4"
      initial={false}
      animate={{ y: songSheetOpen ? "150%" : 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      aria-hidden={songSheetOpen}
      // ホームインジケータの上に載せる。safe-area が無い端末でも最低 0.75rem
      // は浮かせて、画面下端に貼り付いて見えないようにする。
      style={{
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
    >
      <div
        className="pointer-events-auto mx-auto flex max-w-md items-center"
        style={{ height: `${BAR_HEIGHT_REM}rem`, gap: SPLIT_GAP_PX }}
      >
        {/* ── 行き先のタブ (くっつく側) ───────────────────────── */}
        <div className="relative h-full flex-1 rounded-full shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]">
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
              // move ノブはスリム側が springiness / wobble / stretch / trail。
              // stiffness / damping / tail は raw (advanced) 側の名前なので、
              // ここに直接書くと型が弾く (書けても黙って無視される)。
              <Liquid.Item
                effect="move"
                move={{
                  springiness: 0.5,
                  wobble: 0.6,
                  stretch: 0.5,
                  trail: 0.7,
                }}
              >
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

        {/* ── 検索 (離れる側) ───────────────────────────────────
            App Store と同じくラベルを持たない単独の円ボタン。
            カプセルの外なので液体インジケータは届かず、現在地の表現は
            自前の明るいレイヤーで行う。 */}
        <Link
          href={SEARCH_HREF}
          onClick={(e) => {
            triggerHaptic();
            // 検索トップでは検索モードを開き、検索モードでは検索トップへ戻す。
            if (pathname === SEARCH_HREF) {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("app:toggle-search"));
            }
          }}
          aria-label="検索"
          aria-current={searchActive ? "page" : undefined}
          className={cn(
            "relative flex shrink-0 items-center justify-center rounded-full shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]",
            searchActive ? "text-white" : "text-zinc-400",
          )}
          style={{ width: BAR_HEIGHT_PX, height: BAR_HEIGHT_PX }}
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
      </div>
    </motion.nav>
  );
}
