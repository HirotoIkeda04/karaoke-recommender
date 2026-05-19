// ============================================================================
// フレンドの利用状況ダンプ (自分用)
// ============================================================================
// 「友人がアプリを使ってくれているか」を知るための管理スクリプト。
// 新しい計測は追加せず、既存の evaluations / profiles を service_role で
// 集計して表示するだけ (RLS バイパス。ブラウザからは絶対に呼ばない)。
//
// ユーザーごとに次を出す:
//   - 登録日 (profiles.created_at)
//   - 評価数 (rating != 'skip')      ← 実際に評価した曲数
//   - skip 数
//   - 初回評価日 (min evaluations.created_at, skip 除く)
//   - 最終評価日 (max evaluations.updated_at, skip 除く)
//   - 直近 7 日 / 30 日の評価数
// 並びは「最終評価日の新しい順」。評価ゼロのユーザーは末尾。
//
//   pnpm friends:activity            表として出力
//   pnpm friends:activity --json     JSON で出力 (機械可読)
// ============================================================================

import { createAdminClient } from "../src/lib/supabase/admin";

const JST = "Asia/Tokyo";

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

type Agg = {
  name: string;
  signed_up: string;
  evals: number;
  skips: number;
  first_eval: string | null;
  last_eval: string | null;
  last_7d: number;
  last_30d: number;
};

async function main() {
  const asJson = process.argv.includes("--json");
  const supabase = createAdminClient();

  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, display_name, created_at");
  if (pErr) throw pErr;

  // evaluations は件数が多くなりうるので 1000 件ずつページングして全件取得
  const evals: {
    user_id: string;
    rating: string;
    created_at: string;
    updated_at: string;
  }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("evaluations")
      .select("user_id, rating, created_at, updated_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    evals.push(...data);
    if (data.length < PAGE) break;
  }

  const now = Date.now();
  const byUser = new Map<string, Agg>();

  for (const p of profiles ?? []) {
    byUser.set(p.id, {
      name: p.display_name,
      signed_up: fmtDate(p.created_at),
      evals: 0,
      skips: 0,
      first_eval: null,
      last_eval: null,
      last_7d: 0,
      last_30d: 0,
    });
  }

  for (const e of evals) {
    let a = byUser.get(e.user_id);
    if (!a) {
      // profiles に無いユーザー (プロフィール未作成) も拾う
      a = {
        name: `(no profile: ${e.user_id.slice(0, 8)})`,
        signed_up: "-",
        evals: 0,
        skips: 0,
        first_eval: null,
        last_eval: null,
        last_7d: 0,
        last_30d: 0,
      };
      byUser.set(e.user_id, a);
    }

    if (e.rating === "skip") {
      a.skips += 1;
      continue;
    }

    a.evals += 1;
    if (!a.first_eval || e.created_at < a.first_eval) a.first_eval = e.created_at;
    if (!a.last_eval || e.updated_at > a.last_eval) a.last_eval = e.updated_at;
    const ageMs = now - new Date(e.updated_at).getTime();
    if (ageMs <= 7 * DAY_MS) a.last_7d += 1;
    if (ageMs <= 30 * DAY_MS) a.last_30d += 1;
  }

  const rows = [...byUser.values()].sort((x, y) => {
    // 最終評価日の新しい順。null (未評価) は末尾。
    if (x.last_eval && y.last_eval) return x.last_eval < y.last_eval ? 1 : -1;
    if (x.last_eval) return -1;
    if (y.last_eval) return 1;
    return 0;
  });

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.table(
    rows.map((r) => ({
      ユーザー: r.name,
      登録日: r.signed_up,
      評価数: r.evals,
      skip: r.skips,
      初回評価: fmtDate(r.first_eval),
      最終評価: fmtDateTime(r.last_eval),
      "7日": r.last_7d,
      "30日": r.last_30d,
    })),
  );
  console.log(`\n${rows.length} ユーザー / 評価行 ${evals.length} 件 (${fmtDateTime(new Date().toISOString())} 時点)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
