"use client";

import Link from "next/link";

import { JacketImage } from "@/components/ui/jacket-image";
import { midiToKaraoke, noteChipColor } from "@/lib/note";
import type { SimilarSong } from "@/lib/similar-songs";

/** カードの横幅 (rem)。ジャケットは正方形なのでこれが高さの主要素にもなる */
const CARD_WIDTH_REM = 3.75;

/**
 * デッキの詳細表示に出す「似た音域の楽曲」。
 *
 * 楽曲ページ (ボトムシート) は同じ並びを縦のリストで出しているが、こちらは
 * スワイプで開く一枚画面の中に載るので、縦を食わない横カルーセルにしてある。
 * 中身の並び自体は lib/similar-songs.ts で共通化してあるので同じ。
 *
 * デッキ本体は縦スワイプで詳細を開閉するが、この行は横スクロールなので
 * 衝突しない (デッキ側の判定は縦移動が横移動を上回る時だけ通る)。
 */
export function SimilarSongsCarousel({
  songs,
  loading,
}: {
  songs: SimilarSong[] | undefined;
  loading: boolean;
}) {
  // 取得前 / 0 件でも行ごと消すと、開くたびに下半分の高さが変わって
  // レコードが跳ねる。骨組みは残して中身だけ差し替える。
  const showSkeleton = loading || songs === undefined;

  return (
    <section className="w-full" aria-label="似た音域の楽曲">
      <h2 className="px-1 text-[0.625rem] font-semibold uppercase leading-none tracking-wider text-zinc-500 dark:text-zinc-400">
        似た音域の楽曲
      </h2>
      {/* -mr-4 pr-4: 右端で切れずに画面の端まで流れて見えるようにする
          (デッキの px-4 を打ち消す) */}
      <ul
        className="-mr-4 mt-1 flex snap-x snap-mandatory gap-2 overflow-x-auto pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {showSkeleton
          ? Array.from({ length: 4 }, (_, i) => (
              <li
                key={`skeleton-${i}`}
                className="shrink-0"
                style={{ width: `${CARD_WIDTH_REM}rem` }}
                aria-hidden
              >
                <div className="aspect-square w-full animate-pulse rounded-sm bg-zinc-200 dark:bg-zinc-800" />
                <div className="mt-0.5 h-3 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              </li>
            ))
          : songs.map((song) => (
              <li
                key={song.id}
                className="shrink-0 snap-start"
                style={{ width: `${CARD_WIDTH_REM}rem` }}
              >
                <Link href={`/songs/${song.id}`} className="block">
                  <div className="relative aspect-square w-full overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800">
                    {song.image_url_medium ?? song.image_url_small ? (
                      <JacketImage
                        src={
                          (song.image_url_medium ?? song.image_url_small) as string
                        }
                        alt=""
                        fill
                        sizes="3.75rem"
                        className="object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xl text-zinc-400">
                        ♪
                      </div>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[0.6875rem] leading-tight text-zinc-800 dark:text-zinc-100">
                    {song.title}
                  </p>
                  {/* 音域は 1 行に潰す。この行の存在理由が「似た音域」なので、
                      曲名より先にここが読めた方が選びやすい */}
                  <p className="line-clamp-1 font-mono text-[0.625rem] leading-tight">
                    {song.range_low_midi != null &&
                    song.range_high_midi != null ? (
                      <>
                        <span
                          style={{
                            color: noteChipColor(song.range_low_midi).background,
                          }}
                        >
                          {midiToKaraoke(song.range_low_midi)}
                        </span>
                        <span className="text-zinc-500 dark:text-zinc-400">
                          {"–"}
                        </span>
                        <span
                          style={{
                            color: noteChipColor(song.range_high_midi)
                              .background,
                          }}
                        >
                          {midiToKaraoke(song.range_high_midi)}
                        </span>
                      </>
                    ) : (
                      <span className="text-zinc-500 dark:text-zinc-400">—</span>
                    )}
                  </p>
                </Link>
              </li>
            ))}
        {!showSkeleton && songs.length === 0 ? (
          <li className="py-2 text-xs text-zinc-500 dark:text-zinc-400">
            似た音域の曲は見つかりませんでした
          </li>
        ) : null}
      </ul>
    </section>
  );
}
