import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 px-6 dark:bg-zinc-950">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          カラオケ推薦アプリ
        </h1>
        <p className="text-lg text-pink-600 dark:text-pink-400">
          フェーズ1: 音域ベースの楽曲評価(Tailwind 動作確認用)
        </p>
      </div>
      <div className="flex gap-3">
        <Button>Primary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
      </div>
    </main>
  );
}
