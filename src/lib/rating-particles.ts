/**
 * 評価ボタンから飛ぶ火花。
 *
 * 画面全体に canvas を 1 枚だけ敷き、指定座標から短い線を放射させる。
 * 粒が尽きたらループを止めるので、平常時のコストはゼロ。
 *
 * canvas-confetti も検討したが、あれは「形を描いて回す」ライブラリで、
 * 進行方向へ伸びる線 (火花) は表現できない。必要なのはこの 50 行だけ
 * なので依存を足していない。
 */

/** 1 回の発火で出す本数 */
const COUNT = 18;
/** 初速 (px/frame) */
const SPEED_MIN = 5;
const SPEED_MAX = 9.5;
/** 線の太さ */
const WIDTH_MIN = 1.2;
const WIDTH_MAX = 2;
/** 1 フレームあたりの減速と落下 */
const DRAG = 0.9;
const GRAVITY = 0.08;
/** 寿命 (frame) */
const LIFE_MIN = 16;
const LIFE_MAX = 26;
/** 放射の広がり (rad)。上向きを中心に扇状 */
const SPREAD = Math.PI * 1.9;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  color: string;
  life: number;
  age: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let sparks: Spark[] = [];
let frame: number | null = null;

function reduceMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function resize() {
  if (!canvas || !ctx) return;
  // 端末の解像度に合わせる (2 倍で頭打ち。3 倍端末で塗る面積を増やさない)
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  if (typeof document === "undefined") return null;
  canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    // ボトムナビ (z-40 台) より上、モーダルより下
    zIndex: "45",
  });
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
  return ctx;
}

function tick() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  sparks = sparks.filter((s) => s.age < s.life);
  for (const s of sparks) {
    s.age++;
    s.vx *= DRAG;
    s.vy = s.vy * DRAG + GRAVITY;
    s.x += s.vx;
    s.y += s.vy;
    ctx.globalAlpha = Math.max(0, 1 - s.age / s.life);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    // 進行方向の後ろへ尾を引く = 火花の筋
    ctx.lineTo(s.x - s.vx * 2.2, s.y - s.vy * 2.2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  frame = sparks.length ? requestAnimationFrame(tick) : null;
  if (!frame) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * (x, y) から火花を飛ばす。colors は評価色の濃淡 3 色を想定。
 * 「視差を減らす」設定では何もしない。
 */
export function emitSparks(x: number, y: number, colors: readonly string[]) {
  if (reduceMotion() || colors.length === 0) return;
  const context = ensureCanvas();
  if (!context) return;
  for (let i = 0; i < COUNT; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * SPREAD;
    const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      width: WIDTH_MIN + Math.random() * (WIDTH_MAX - WIDTH_MIN),
      color: colors[i % colors.length],
      life: LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN),
      age: 0,
    });
  }
  if (!frame) frame = requestAnimationFrame(tick);
}
