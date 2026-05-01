"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import {
  acceptFriendRequest,
  cancelOutgoingRequest,
  rejectFriendRequest,
} from "./actions";

export interface FriendItem {
  otherId: string;
  otherName: string;
}

interface Props {
  accepted: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
}

export function FriendList({ accepted, incoming, outgoing }: Props) {
  return (
    <div className="space-y-5">
      {incoming.length > 0 ? (
        <Section title={`申請を受けています (${incoming.length})`}>
          {incoming.map((friend) => (
            <IncomingRow key={friend.otherId} friend={friend} />
          ))}
        </Section>
      ) : null}

      {outgoing.length > 0 ? (
        <Section title={`申請中 (${outgoing.length})`}>
          {outgoing.map((friend) => (
            <OutgoingRow key={friend.otherId} friend={friend} />
          ))}
        </Section>
      ) : null}

      <Section title={`フレンド (${accepted.length})`}>
        {accepted.length === 0 ? (
          <p className="px-4 py-4 text-sm text-zinc-500 dark:text-zinc-500">
            まだフレンドがいません。招待リンクを発行して友達に送りましょう
          </p>
        ) : (
          accepted.map((friend) => (
            <AcceptedRow key={friend.otherId} friend={friend} />
          ))
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
      </h2>
      <div className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
    </section>
  );
}

function AcceptedRow({ friend }: { friend: FriendItem }) {
  return (
    <Link
      href={`/u/${friend.otherId}`}
      className="flex items-center px-4 py-3 transition active:bg-zinc-50 dark:active:bg-zinc-800"
    >
      <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {friend.otherName}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-500">›</span>
    </Link>
  );
}

function IncomingRow({ friend }: { friend: FriendItem }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const accept = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptFriendRequest(friend.otherId);
      if (result.error) setError(result.error);
    });
  };

  const reject = () => {
    setError(null);
    startTransition(async () => {
      const result = await rejectFriendRequest(friend.otherId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="space-y-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {friend.otherName}
        </span>
        <Button onClick={accept} size="sm" disabled={pending}>
          承認
        </Button>
        <Button
          onClick={reject}
          size="sm"
          variant="outline"
          disabled={pending}
        >
          拒否
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}

function OutgoingRow({ friend }: { friend: FriendItem }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setError(null);
    startTransition(async () => {
      const result = await cancelOutgoingRequest(friend.otherId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="space-y-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {friend.otherName}
        </span>
        <Button onClick={cancel} size="sm" variant="ghost" disabled={pending}>
          取消
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
