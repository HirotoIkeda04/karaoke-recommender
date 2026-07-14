import { SongBottomSheet } from "@/components/song-bottom-sheet";

export default function SongSheetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SongBottomSheet>{children}</SongBottomSheet>;
}
