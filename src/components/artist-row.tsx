import Image from "next/image";
import Link from "next/link";

export interface ArtistRowData {
  id: string;
  name: string;
  song_count: number | null;
  image_url: string | null;
}

interface ArtistRowProps {
  artist: ArtistRowData;
  /** タップ時のフック (履歴保存など)。Link 遷移は引き続き走る */
  onSelect?: (a: ArtistRowData) => void;
}

export function ArtistRow({ artist, onSelect }: ArtistRowProps) {
  return (
    <Link
      href={`/artists/${artist.id}`}
      onClick={onSelect ? () => onSelect(artist) : undefined}
      className="flex items-center gap-3 rounded-md p-2 transition hover:bg-zinc-100 active:bg-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800/60"
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        {artist.image_url ? (
          <Image
            src={artist.image_url}
            alt=""
            fill
            sizes="3rem"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-base text-zinc-500">
            {artist.name.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {artist.name}
        </p>
        <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
          アーティスト
          {artist.song_count != null ? ` · ${artist.song_count} 曲` : ""}
        </p>
      </div>
    </Link>
  );
}
