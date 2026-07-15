/**
 * 検索タブの公開ブラウズスナップショットを更新する。
 *
 * DB側の refresh_browse_snapshot() は SECURITY INVOKER で、
 * service_role だけに実行権限を付与している。
 */
import { createAdminClient } from "../src/lib/supabase/admin";

async function main() {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("refresh_browse_snapshot");
  if (error) throw error;
  console.log("browse snapshot refreshed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
