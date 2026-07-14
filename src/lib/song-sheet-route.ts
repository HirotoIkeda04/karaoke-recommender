/** 並列ルート @songSheet が実際の曲詳細を表示しているか判定する。 */
export function isSongSheetOpen(
  pathname: string,
  songSheetSegment: string | null,
): boolean {
  // catch-all も /songs では "songs" を返すため、セグメントだけでは
  // 検索トップを曲詳細シートと区別できない。
  return (
    songSheetSegment === "songs" && /^\/songs\/[^/]+\/?$/.test(pathname)
  );
}
