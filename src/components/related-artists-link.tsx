import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { JacketImage } from "@/components/ui/jacket-image";
import type { RelatedArtistPreview } from "@/lib/related-artists";

interface RelatedArtistsLinkProps {
  artistId: string;
  artists: ReadonlyArray<RelatedArtistPreview>;
}

export function RelatedArtistsLink({
  artistId,
  artists,
}: RelatedArtistsLinkProps) {
  if (artists.length === 0) return null;

  return (
    <Link
      href={`/artists/${artistId}/related`}
      className="flex h-9 w-full items-center rounded-full bg-zinc-100 px-3 text-zinc-700 shadow-sm transition hover:bg-zinc-200 active:scale-[0.99] active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      aria-label="関連アーティストと代表楽曲を見る"
    >
      <span className="shrink-0 text-xs font-medium">関連アーティスト</span>
      <span className="ml-2 flex -space-x-1.5" aria-hidden>
        {artists.slice(0, 3).map((artist) => (
          <span
            key={artist.id}
            className="relative size-6 overflow-hidden rounded-full border-2 border-zinc-100 bg-zinc-300 dark:border-zinc-800 dark:bg-zinc-700"
          >
            {artist.imageUrl ? (
              <JacketImage
                src={artist.imageUrl}
                alt=""
                fill
                sizes="1.5rem"
                className="object-cover"
              />
            ) : (
              <span className="grid h-full place-items-center text-[9px] font-semibold">
                {artist.name.slice(0, 1)}
              </span>
            )}
          </span>
        ))}
      </span>
      <ChevronRight className="ml-auto size-4 text-zinc-500" aria-hidden />
    </Link>
  );
}
