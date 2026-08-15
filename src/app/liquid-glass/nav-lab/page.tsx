"use client";

/**
 * ボトムナビの「動き」3案を実機で見比べるための開発用ルート。
 * /liquid-glass 配下なので未ログインで開け、本番では proxy.ts が 404 にする。
 *
 *   lens … 選択インジケータがガラスレンズ。下のアイコンを屈折させる。
 *          (@samasante/liquid-glass の wrap モード。現行の実装と同じ)
 *   goo  … 選択インジケータが液体の塊。尾を引いて追ってくる。
 *          (liquid-gooey の Move エフェクト。モーションは goo に一本化)
 *   both … lens の children に goo を入れ子にした版。レンズが goo ごと屈折させる。
 *
 * 3 案とも iOS Safari で動くことは個別に確認済み。ここで見るのは
 * 「どれが気持ちいいか」と「both が情報過多にならないか」。
 */

import {
  Glass,
  type GlassOptics,
  animateGlassValue,
  cubicBezier,
  deriveGlass,
  glassValue,
  useLensWobble,
} from "@samasante/liquid-glass";
import { Liquid } from "liquid-gooey";
import { Home, LibraryBig, Search, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { GlassSurface } from "@/components/ui/glass-surface";

const ITEMS = [
  { label: "評価", icon: Home },
  { label: "検索", icon: Search },
  { label: "ライブラリ", icon: LibraryBig },
  { label: "ルーム", icon: Users },
];

const BAR_H = 64;
const LENS_W = 66;
const LENS_H = 50;
const LENS_R = 25;
const PILL_H = 48;

const EASE = cubicBezier(0.34, 1.36, 0.42, 1);
const MOVE_ANIM = { ease: EASE, duration: 0.52 };
const CSS_MOVE = "transform .52s cubic-bezier(.34,1.36,.42,1)";

/**
 * wrap モードでは strength / dispersion は「フィルタを掛ける要素の箱」
 * = バー全幅 (約 343px) に対する割合。24px のアイコン基準で 0.016 前後。
 */
const LENS: Partial<GlassOptics> = {
  mapSize: 256,
  depth: 0.5,
  dispersion: 0.22,
  strength: 0.016,
  clipToShape: true,
  softEdge: true,
  curvature: 0.35,
  splay: 0.4,
  bend: 0.3,
  bendWidth: 0.14,
  frost: 0,
  brightness: 0.09,
  specular: 1.1,
  sheenAngle: 45,
  glow: 0.16,
  glowSpread: 0.5,
  glowFalloff: 1.5,
  sheen: 0.5,
  sheenWidth: 3,
  sheenFalloff: 1.5,
  edgeShadow: "0 2px 10px rgba(0,0,0,0.4)",
};

/** goo の fill は必ず不透明色。alpha' = 20a - 7.83 なので半透明だと消える。 */
const GOO_FILL = "#3a3a3a";

type Variant = "lens" | "goo" | "both";

function Tabs({
  active,
  onPick,
}: {
  active: number;
  onPick: (i: number) => void;
}) {
  return (
    <ul className="grid h-full grid-cols-4 items-center">
      {ITEMS.map((item, i) => {
        const Icon = item.icon;
        return (
          <li key={item.label} className="min-w-0">
            <button
              type="button"
              onClick={() => onPick(i)}
              aria-label={item.label}
              aria-current={i === active ? "page" : undefined}
              className={`flex w-full items-center justify-center py-3 ${
                i === active ? "text-white" : "text-zinc-400"
              }`}
            >
              <Icon className="size-6" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 移動するガラスレンズ。motion value 1 本で駆動する。 */
function useLens(active: number) {
  const mv = useMemo(() => {
    const pos = glassValue((active + 0.5) / ITEMS.length);
    const stretch = glassValue(0);
    const w = deriveGlass([stretch], () => LENS_W * (1 + 0.28 * stretch.get()));
    const h = deriveGlass([stretch], () => LENS_H * (1 - 0.18 * stretch.get()));
    return { pos, stretch, w, h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const holdRef = useRef(0);
  const kickRef = useRef<() => void>(() => {});
  useLensWobble(mv.pos, mv.stretch, holdRef, kickRef);

  useEffect(() => {
    animateGlassValue(mv.pos, (active + 0.5) / ITEMS.length, MOVE_ANIM);
    kickRef.current();
  }, [active, mv.pos]);

  return mv;
}

/** goo のインジケータ本体。中身は透明で、見えるのは液体シルエットだけ。 */
function GooIndicator({ active }: { active: number }) {
  return (
    // スリムノブは springiness / wobble / stretch / trail の 4 つ。
    // stiffness / damping / tail は raw 側 (advanced) の名前なので、
    // ここに直接書いても型が弾く (書けても黙って無視される)。
    <Liquid.Item
      effect="move"
      move={{ springiness: 0.5, wobble: 0.6, stretch: 0.5, trail: 0.7 }}
    >
      <div
        style={{
          position: "absolute",
          top: (BAR_H - PILL_H) / 2,
          left: 0,
          width: "25%",
          height: PILL_H,
          borderRadius: PILL_H / 2,
          transform: `translateX(${active * 100}%)`,
          transition: CSS_MOVE,
        }}
      />
    </Liquid.Item>
  );
}

function LensNav({
  active,
  onPick,
}: {
  active: number;
  onPick: (i: number) => void;
}) {
  const mv = useLens(active);
  return (
    <Glass
      optics={LENS}
      center={{ x: mv.pos, y: 0.5 }}
      size={[mv.w, mv.h]}
      radius={LENS_R}
      behind="transparent"
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        height: "100%",
        borderRadius: 9999,
      }}
    >
      <Tabs active={active} onPick={onPick} />
    </Glass>
  );
}

function GooNav({
  active,
  onPick,
}: {
  active: number;
  onPick: (i: number) => void;
}) {
  return (
    <Liquid
      blur={8}
      contrast={20}
      fill={GOO_FILL}
      filterPadding={40}
      style={{ position: "relative", height: "100%" }}
    >
      <GooIndicator active={active} />
      <Tabs active={active} onPick={onPick} />
    </Liquid>
  );
}

function BothNav({
  active,
  onPick,
}: {
  active: number;
  onPick: (i: number) => void;
}) {
  const mv = useLens(active);
  return (
    <Glass
      optics={LENS}
      center={{ x: mv.pos, y: 0.5 }}
      size={[mv.w, mv.h]}
      radius={LENS_R}
      behind="transparent"
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        height: "100%",
        borderRadius: 9999,
      }}
    >
      <Liquid
        blur={8}
        contrast={20}
        fill={GOO_FILL}
        filterPadding={40}
        style={{ position: "relative", height: "100%" }}
      >
        <GooIndicator active={active} />
        <Tabs active={active} onPick={onPick} />
      </Liquid>
    </Glass>
  );
}

const SWATCHES = [
  "linear-gradient(135deg,#f43f5e,#f59e0b)",
  "linear-gradient(135deg,#8b5cf6,#ec4899)",
  "linear-gradient(135deg,#06b6d4,#3b82f6)",
  "linear-gradient(135deg,#22c55e,#84cc16)",
  "linear-gradient(135deg,#eab308,#f97316)",
  "linear-gradient(135deg,#6366f1,#06b6d4)",
];

const VARIANTS: { key: Variant; label: string; hint: string }[] = [
  { key: "lens", label: "lens", hint: "屈折レンズ (現行)" },
  { key: "goo", label: "goo", hint: "液体の尾" },
  { key: "both", label: "both", hint: "レンズ + 液体" },
];

export default function NavLabPage() {
  const [variant, setVariant] = useState<Variant>("lens");
  const [active, setActive] = useState(0);

  const Nav =
    variant === "lens" ? LensNav : variant === "goo" ? GooNav : BothNav;

  return (
    <div className="min-h-dvh bg-background pb-40">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-background/95 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-md gap-2">
          {VARIANTS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setVariant(v.key)}
              className={`flex-1 rounded-full px-3 py-2 text-xs font-medium transition ${
                variant === v.key
                  ? "bg-white text-zinc-900"
                  : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="mx-auto mt-1.5 max-w-md text-center text-[11px] text-zinc-500">
          {VARIANTS.find((v) => v.key === variant)?.hint} — 下のタブを押して動きを見る
        </p>
      </div>

      <div className="space-y-2 p-3">
        {Array.from({ length: 22 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className="size-14 shrink-0 rounded-md"
              style={{ background: SWATCHES[i % SWATCHES.length] }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                サンプル楽曲 {i + 1} — Sample Track
              </div>
              <div className="text-xs text-zinc-400">アーティスト名 · ~ hiF</div>
            </div>
          </div>
        ))}
      </div>

      {/* 本番のナビと同じ寸法・同じすりガラス土台 */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4">
        <div
          className="pointer-events-auto relative mx-auto max-w-md rounded-full shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]"
          style={{
            height: BAR_H,
            marginBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <GlassSurface variant="bar" radius={9999} />
          {/* key で案を切り替えたときに motion value を作り直す */}
          <Nav key={variant} active={active} onPick={setActive} />
        </div>
      </div>
    </div>
  );
}
