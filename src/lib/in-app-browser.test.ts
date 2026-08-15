import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChromeSchemeUrl,
  buildExternalBrowserUrl,
  detectInAppBrowser,
} from "./in-app-browser";

const PAGE = "https://kyokumoku.example/songs?tab=easy";

test("iOS は https を googlechromes:// に差し替える", () => {
  assert.equal(
    buildChromeSchemeUrl(PAGE, "ios"),
    "googlechromes://kyokumoku.example/songs?tab=easy",
  );
  assert.equal(
    buildChromeSchemeUrl("http://example.com/", "ios"),
    "googlechrome://example.com/",
  );
});

test("Android の Chrome intent は package とフォールバックを持つ", () => {
  const url = buildChromeSchemeUrl(PAGE, "android")!;
  assert.match(url, /^intent:\/\/kyokumoku\.example\/songs\?tab=easy#Intent;/);
  assert.match(url, /package=com\.android\.chrome;/);
  assert.match(url, /S\.browser_fallback_url=https%3A%2F%2F/);
});

// iOS には Safari を名指しで開く scheme が無いので、LINE の
// openExternalBrowser=1 が唯一の経路。ここが壊れると iOS の
// 「Safari で開く」導線が丸ごと死ぬ。
test("LINE は openExternalBrowser=1 を付けて既定ブラウザへ渡す", () => {
  assert.equal(
    buildExternalBrowserUrl(PAGE, "ios", "line"),
    "https://kyokumoku.example/songs?tab=easy&openExternalBrowser=1",
  );
  // 既に付いていても重複させない
  assert.equal(
    buildExternalBrowserUrl(
      "https://kyokumoku.example/?openExternalBrowser=1",
      "ios",
      "line",
    ),
    "https://kyokumoku.example/?openExternalBrowser=1",
  );
});

test("iOS の LINE 以外は既定ブラウザへ渡す手段が無い", () => {
  assert.equal(buildExternalBrowserUrl(PAGE, "ios", "instagram"), null);
  assert.equal(buildExternalBrowserUrl(PAGE, "ios", "facebook"), null);
});

test("Android は package 指定なしの intent でブラウザ選択に委ねる", () => {
  const url = buildExternalBrowserUrl(PAGE, "android", "instagram")!;
  assert.match(url, /^intent:\/\//);
  assert.equal(url.includes("package="), false);
});

test("アプリ内ブラウザの UA を種類まで判定する", () => {
  assert.deepEqual(
    detectInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Line/13.0.0",
    ),
    { inApp: true, kind: "line" },
  );
  assert.deepEqual(
    detectInAppBrowser("Mozilla/5.0 (iPhone) Instagram 300.0.0.0"),
    { inApp: true, kind: "instagram" },
  );
  assert.deepEqual(
    detectInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/605.1.15",
    ),
    { inApp: false, kind: null },
  );
});
