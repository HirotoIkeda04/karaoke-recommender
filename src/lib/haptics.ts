// iOS Safari は Vibration API 非対応で何も起きない。Android のみ動作。
export function triggerHaptic(durationMs = 15) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  navigator.vibrate(durationMs);
}
