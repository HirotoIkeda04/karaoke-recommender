"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
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
  const [isAdding, setIsAdding] = useState(false);

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
      setIsAdding(false);
      setToast({ id: Date.now(), message: "記録を追加しました" });
    });
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setForm(emptyForm());
    setError(null);
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
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          歌った記録
        </h2>
        {!isAdding ? (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Plus className="size-3.5" aria-hidden />
            記録を追加
          </button>
        ) : null}
      </div>

      {isAdding ? (
        <LogForm
          form={form}
          onChange={setForm}
          disabled={isPending}
          submitLabel="記録する"
          onSubmit={handleCreate}
          onCancel={handleCancelAdd}
        />
      ) : null}

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <ul className="space-y-2">
        {sortedLogs.length === 0 && !isAdding ? (
          <li className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            まだ記録がありません
          </li>
        ) : null}

        {sortedLogs.map((log) =>
          editing?.id === log.id ? (
            <li key={log.id} className="rounded-xl bg-zinc-100/60 p-3 dark:bg-zinc-900/60">
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
              className="rounded-xl bg-zinc-100/60 px-4 py-3 dark:bg-zinc-900/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono">{formatDate(log.logged_at)}</span>
                    {log.equipment ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>
                          {EQUIPMENT_LABELS[log.equipment as Equipment] ??
                            log.equipment}
                        </span>
                      </>
                    ) : null}
                    {log.key_shift !== null ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="font-mono">
                          {formatKeyShift(log.key_shift)}
                        </span>
                      </>
                    ) : null}
                  </div>
                  {log.score !== null ? (
                    <div className="font-mono text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                      {formatScore(log.score)}
                      <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                        点
                      </span>
                    </div>
                  ) : null}
                  {log.body ? (
                    <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                      {log.body}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ id: log.id, form: fromLog(log) })
                    }
                    disabled={isPending}
                    aria-label="編集"
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-200"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(log.id)}
                    disabled={isPending}
                    aria-label="削除"
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
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
    "w-full rounded-lg border-0 bg-zinc-200/60 px-3 py-2 text-sm transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 dark:bg-zinc-800/70 dark:focus:bg-zinc-900";
  const labelCls = "space-y-1 text-xs text-zinc-600 dark:text-zinc-400";

  return (
    <form
      className="space-y-3 rounded-xl bg-zinc-100/60 p-4 dark:bg-zinc-900/60"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid grid-cols-4 gap-2">
        <label className={`col-span-2 ${labelCls}`}>
          <span>記録日</span>
          <input
            type="date"
            value={form.loggedAt}
            onChange={(e) => onChange({ ...form, loggedAt: e.target.value })}
            disabled={disabled}
            className={inputCls}
          />
        </label>
        <div className="col-span-2" />
        <label className={`col-span-2 ${labelCls}`}>
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
            className={inputCls}
          >
            <option value="">—</option>
            <option value="dam">DAM</option>
            <option value="joysound">JOYSOUND</option>
          </select>
        </label>
        <label className={labelCls}>
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
            className={`${inputCls} font-mono`}
          />
        </label>
        <label className={labelCls}>
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
            className={`${inputCls} font-mono`}
          />
        </label>
      </div>

      <textarea
        value={form.body}
        onChange={(e) => onChange({ ...form, body: e.target.value })}
        disabled={disabled}
        placeholder="気づいたこと、歌った感想など"
        rows={3}
        className={`${inputCls} resize-none placeholder:text-zinc-400`}
      />

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-200/60 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            キャンセル
          </button>
        ) : null}
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
