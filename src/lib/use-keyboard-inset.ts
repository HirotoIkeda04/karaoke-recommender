"use client";

import { useEffect, useState } from "react";

/**
 * ソフトウェアキーボードに覆われている高さ (px)。覆われていなければ 0。
 *
 *   隠れている高さ = innerHeight - (visualViewport.height + offsetTop)
 *
 * position: fixed はレイアウトビューポート基準なので、キーボードが出ても
 * レイアウトビューポートが縮まないブラウザでは、下端に貼り付けた要素が
 * キーボードの裏に隠れる。その差分を返し、呼び出し側で持ち上げる。
 *
 * ただし iOS Safari では、この値は実測で **常に 0** になる。iPhone 17 Pro /
 * iOS 26.5 での実測値:
 *
 *   キーボードなし   inner=714  vv=714  offsetTop=0    → 0
 *   キーボードあり   inner=714  vv=376  offsetTop=338  → 0
 *
 * iOS はキーボードを出すとき visual viewport を縮めるだけでなく、同じ量だけ
 * 下へずらして「visual viewport の下端 = レイアウトビューポートの下端」を
 * 保つ。つまり下端固定の要素は放っておいてもキーボードの直上に来るので、
 * 持ち上げは不要 (offsetTop を足さずに計算すると、iOS でだけ二重に持ち上げて
 * 宙に浮く。この項は消さないこと)。
 *
 * それでもこのフックを残しているのは Android Chrome のため。既定の
 * interactive-widget=resizes-visual ではレイアウトビューポートが縮まず
 * offsetTop も動かないので、こちらは実際に正の値が返り、持ち上げが要る。
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const hidden = window.innerHeight - (viewport.height + viewport.offsetTop);
      // Safari のアドレスバー伸縮でも数十 px の差が出るので、
      // それをキーボードと誤認しないよう下限を設ける。
      setInset(hidden > 80 ? Math.round(hidden) : 0);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
