"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  type Equipment,
  createSongLog,
  deleteSongLog,
  updateSongLog,
} from "./song-log-actions";

export interface SongLog {
  id: string;
  logged_at: string;
  equipment: string | null;
  key_shift: number | null;
  score: number | null;
  body: string | null;
}

interface SongLogsProps {
  songId: string;
  initialLogs: SongLog[];
}

interface FormState {
  loggedAt: string;
  equipment: "" | Equipment;
  keyShift: string;
  score: string;
  body: string;
}

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  dam: "DAM",
  joysound: "JOYSOUND",
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyForm(): FormState {
  return {
    loggedAt: todayIso(),
    equipment: "",
    keyShift: "",
    score: "",
    body: "",
  };
}

function fromLog(log: SongLog): FormState {
  return {
    loggedAt: log.logged_at,
    equipment: (log.equipment as Equipment | null) ?? "",
    keyShift: log.key_shift !== null ? String(log.key_shift) : "",
    score: log.score !== null ? String(log.score) : "",
    body: log.body ?? "",
  };
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}/${m}/${d}`;
}

function formatKeyShift(n: number): string {
  if (n === 0) return "原曲キー";
  return `${n > 0 ? "+" : ""}${n}`;
}

function formatScore(n: number): string {
  const fixed = n.toFixed(3);
  return fixed.replace(/\.?0+$/, "") || "0";
}

function parseFormToInput(form: FormState) {
  const trimmedKey = form.keyShift.trim();
  const keyShift = trimmedKey === "" ? null : Number.parseInt(trimmedKey, 10);
  const trimmedScore = form.score.trim();
  const score = trimmedScore === "" ? null : Number.parseFloat(trimmedScore);
  return {
    loggedAt: form.loggedAt,
    equipment: form.equipment === "" ? null : form.equipment,
    keyShift: Number.isNaN(keyShift as number) ? null : keyShift,
    score: score === null || Number.isNaN(score) ? null : score,
    body: form.body,
  };
}

export function SongLogs({ songId, initialLogs }: SongLogsProps) {
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [editing, setEditing] = useState<{ id: string; form: FormState } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const sortedLogs = useMemo(
    () =>
      [...initialLogs].sort((a, b) =>
        a.logged_at === b.logged_at
          ? a.id < b.id
            ? 1
            : -1
          : a.logged_at < b.logged_at
            ? 1
            : -1,
      ),
    [initialLogs],
  );

  const handleCreate = () => {
    setError(null);
    const input = parseFormToInput(form);
    startTransition(async () => {
      const res = await createSongLog({ songId, ...input });
      if (!res.ok) {
        setError(res.error ?? "保存に失敗しました");
        return;
      }
      setForm(emptyForm());
      setToast({ id: Date.now(), message: "記録を追加しました" });
    });
  };

  const handleUpdate = () => {
    if (!editing) return;
    setError(null);
    const input = parseFormToInput(editing.form);
    startTransition(async () => {
      const res = await updateSongLog({ id: editing.id, songId, ...input });
      if (!res.ok) {
        setError(res.error ?? "保存に失敗しました");
        return;
      }
      setEditing(null);
      setToast({ id: Date.now(), message: "記録を更新しました" });
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("この記録を削除しますか？")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSongLog(songId, id);
      if (!res.ok) {
        setError(res.error ?? "削除に失敗しました");
        return;
      }
      if (editing?.id === id) setEditing(null);
      setToast({ id: Date.now(), message: "記録を削除しました" });
    });
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        歌った記録
      </h2>

      <LogForm
        form={form}
        onChange={setForm}
        disabled={isPending}
        submitLabel="記録する"
        onSubmit={handleCreate}
      />

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <ul className="space-y-3">
        {sortedLogs.length === 0 ? (
          <li className="rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            まだ記録がありません
          </li>
        ) : null}

        {sortedLogs.map((log) =>
          editing?.id === log.id ? (
            <li
              key={log.id}
              className="rounded-xl border border-pink-300 bg-pink-50/50 p-3 dark:border-pink-700/60 dark:bg-pink-950/20"
            >
              <LogForm
                form={editing.form}
                onChange={(next) => setEditing({ id: log.id, form: next })}
                disabled={isPending}
                submitLabel="更新する"
                onSubmit={handleUpdate}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={log.id}
              className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">
                    {formatDate(log.logged_at)}
                  </span>
                  {log.equipment ? (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {EQUIPMENT_LABELS[log.equipment as Equipment] ??
                        log.equipment}
                    </span>
                  ) : null}
                  {log.key_shift !== null ? (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {formatKeyShift(log.key_shift)}
                    </span>
                  ) : null}
                  {log.score !== null ? (
                    <span className="rounded-full bg-pink-100 px-2 py-0.5 font-mono font-semibold text-pink-700 dark:bg-pink-950/50 dark:text-pink-300">
                      {formatScore(log.score)}点
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ id: log.id, form: fromLog(log) })
                    }
                    disabled={isPending}
                    aria-label="編集"
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(log.id)}
                    disabled={isPending}
                    aria-label="削除"
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
              {log.body ? (
                <p className="text-sm whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                  {log.body}
                </p>
              ) : null}
            </li>
          ),
        )}
      </ul>

      {toast ? (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
        >
          <div className="animate-in fade-in slide-in-from-bottom-2 rounded-full bg-zinc-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur dark:bg-zinc-100/90 dark:text-zinc-900">
            {toast.message}
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface LogFormProps {
  form: FormState;
  onChange: (next: FormState) => void;
  disabled: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel?: () => void;
}

function LogForm({
  form,
  onChange,
  disabled,
  submitLabel,
  onSubmit,
  onCancel,
}: LogFormProps) {
  const inputCls =
    "rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm focus:border-pink-500 focus:outline-none disabled:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-950";

  return (
    <form
      className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span>記録日</span>
          <input
            type="date"
            value={form.loggedAt}
            onChange={(e) => onChange({ ...form, loggedAt: e.target.value })}
            disabled={disabled}
            className={`${inputCls} w-full`}
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span>機材</span>
          <select
            value={form.equipment}
            onChange={(e) =>
              onChange({
                ...form,
                equipment: e.target.value as "" | Equipment,
              })
            }
            disabled={disabled}
            className={`${inputCls} w-full`}
          >
            <option value="">—</option>
            <option value="dam">DAM</option>
            <option value="joysound">JOYSOUND</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span>点数</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.001}
            placeholder="—"
            value={form.score}
            onChange={(e) => onChange({ ...form, score: e.target.value })}
            disabled={disabled}
            className={`${inputCls} w-full font-mono`}
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span>キー調整</span>
          <input
            type="number"
            inputMode="numeric"
            min={-12}
            max={12}
            step={1}
            placeholder="±0"
            value={form.keyShift}
            onChange={(e) => onChange({ ...form, keyShift: e.target.value })}
            disabled={disabled}
            className={`${inputCls} w-full font-mono`}
          />
        </label>
      </div>

      <textarea
        value={form.body}
        onChange={(e) => onChange({ ...form, body: e.target.value })}
        disabled={disabled}
        placeholder="気づいたこと、歌った感想など"
        rows={3}
        className={`${inputCls} w-full resize-none placeholder:text-zinc-400`}
      />

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            キャンセル
          </button>
        ) : null}
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg bg-pink-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-pink-600 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
