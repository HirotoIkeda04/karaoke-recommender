// Supabase (PostgREST) は 1 リクエスト最大 1000 行しか返さない。.limit()/.range()
// を明示しても超えられない (実測確認済み)。評価が 1000 件を超えるユーザーで古い
// 行が切り捨てられる不具合を防ぐため、range() でページ送りして全件取得する。
//
// テーブル select でも set-returning RPC でも、range(from, to) を適用済みの
// クエリを返す buildPage を渡せば共通で使える。
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * range() でページ送りしながら、対象クエリの行を 1000 行上限を越えて全件取得する。
 *
 * @param buildPage `range(from, to)` を適用済みのクエリ (PromiseLike) を返す関数。
 *   テーブル select / set-returning RPC のどちらでも可。
 */
export async function fetchAllPaginated<T>(
  buildPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) return { data: all, error };
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
  }
  return { data: all, error: null };
}
