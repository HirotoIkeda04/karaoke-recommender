"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

interface SearchFormProps {
  defaultQuery: string;
  defaultHighMax: string;
  defaultHighMin: string;
}

const HIGH_OPTIONS = [
  "",
  "mid2C", "mid2E", "mid2G",
  "hiA", "hiC", "hiD", "hiE", "hiF",
];

export function SearchForm({
  defaultQuery,
  defaultHighMax,
  defaultHighMin,
}: SearchFormProps) {
  const router = useRouter();
  const params = useSearchParams();

  const [q, setQ] = useState(defaultQuery);
  const [highMax, setHighMax] = useState(defaultHighMax);
  const [highMin, setHighMin] = useState(defaultHighMin);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params.toString());
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    if (highMax) next.set("high_max", highMax);
    else next.delete("high_max");
    if (highMin) next.set("high_min", highMin);
    else next.delete("high_min");
    router.push(`/songs?${next.toString()}`);
  };

  const handleReset = () => {
    setQ("");
    setHighMax("");
    setHighMin("");
    router.push("/songs");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="曲名 / アーティスト"
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-pink-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          最高音 ≥
          <select
            value={highMin}
            onChange={(e) => setHighMin(e.target.value)}
            className="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {HIGH_OPTIONS.map((v) => (
              <option key={`min-${v}`} value={v}>
                {v || "—"}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          最高音 ≤
          <select
            value={highMax}
            onChange={(e) => setHighMax(e.target.value)}
            className="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {HIGH_OPTIONS.map((v) => (
              <option key={`max-${v}`} value={v}>
                {v || "—"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1">
          検索
        </Button>
        <Button type="button" variant="outline" onClick={handleReset}>
          クリア
        </Button>
      </div>
    </form>
  );
}
