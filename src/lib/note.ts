/**
 * MIDI note number ↔ カラオケ表記 (lowlowA … hihiG#) の相互変換。
 * Python 側の scraper/src/note_converter.py と整合性を保つこと。
 *
 * 基準: hiA = A4 = MIDI 69、オクターブ境界は A (C 基準ではない点に注意)
 */

const NOTE_TABLE: Record<string, number> = {
  // lowlow (A0 - G#1)
  lowlowA: 21, "lowlowA#": 22, lowlowB: 23,
  lowlowC: 24, "lowlowC#": 25, lowlowD: 26, "lowlowD#": 27,
  lowlowE: 28, lowlowF: 29, "lowlowF#": 30, lowlowG: 31, "lowlowG#": 32,
  // low (A1 - G#2)
  lowA: 33, "lowA#": 34, lowB: 35,
  lowC: 36, "lowC#": 37, lowD: 38, "lowD#": 39,
  lowE: 40, lowF: 41, "lowF#": 42, lowG: 43, "lowG#": 44,
  // mid1 (A2 - G#3)
  mid1A: 45, "mid1A#": 46, mid1B: 47,
  mid1C: 48, "mid1C#": 49, mid1D: 50, "mid1D#": 51,
  mid1E: 52, mid1F: 53, "mid1F#": 54, mid1G: 55, "mid1G#": 56,
  // mid2 (A3 - G#4)
  mid2A: 57, "mid2A#": 58, mid2B: 59,
  mid2C: 60, "mid2C#": 61, mid2D: 62, "mid2D#": 63,
  mid2E: 64, mid2F: 65, "mid2F#": 66, mid2G: 67, "mid2G#": 68,
  // hi (A4 - G#5)
  hiA: 69, "hiA#": 70, hiB: 71,
  hiC: 72, "hiC#": 73, hiD: 74, "hiD#": 75,
  hiE: 76, hiF: 77, "hiF#": 78, hiG: 79, "hiG#": 80,
  // hihi (A5 - G#6)
  hihiA: 81, "hihiA#": 82, hihiB: 83,
  hihiC: 84, "hihiC#": 85, hihiD: 86, "hihiD#": 87,
  hihiE: 88, hihiF: 89, "hihiF#": 90, hihiG: 91, "hihiG#": 92,
};

const REVERSE_NOTE_TABLE: Record<number, string> = Object.fromEntries(
  Object.entries(NOTE_TABLE).map(([k, v]) => [v, k]),
);

export function midiToKaraoke(midi: number | null | undefined): string {
  if (midi == null) return "—";
  const rounded = Math.round(midi);
  return REVERSE_NOTE_TABLE[rounded] ?? `MIDI ${rounded}`;
}

export function karaokeToMidi(notation: string): number | null {
  return NOTE_TABLE[notation] ?? null;
}
