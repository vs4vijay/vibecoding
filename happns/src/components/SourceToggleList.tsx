"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  DISABLED_SOURCES_COOKIE,
  serializeDisabledSources,
} from "@/lib/sourcePrefs";
import type { SourceId } from "@/lib/sources/types";

interface SourceMeta {
  id: SourceId;
  label: string;
  description: string;
}

interface SourceToggleListProps {
  sources: SourceMeta[];
  initialDisabled: SourceId[];
}

export function SourceToggleList({
  sources,
  initialDisabled,
}: SourceToggleListProps) {
  const router = useRouter();
  const [disabled, setDisabled] = useState<Set<SourceId>>(
    new Set(initialDisabled),
  );
  const [pending, startTransition] = useTransition();

  function persist(next: Set<SourceId>) {
    const value = serializeDisabledSources(next);
    // 1 year, root path. No need for HttpOnly — this is a user preference.
    document.cookie =
      `${DISABLED_SOURCES_COOKIE}=${encodeURIComponent(value)}; ` +
      `path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  function toggle(id: SourceId) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist(next);
      return next;
    });
  }

  return (
    <ul className="divide-y divide-[var(--border)]">
      {sources.map((s) => {
        const enabled = !disabled.has(s.id);
        return (
          <li
            key={s.id}
            className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
          >
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold">{s.label}</h3>
              <p className="text-sm text-[var(--muted)] mt-0.5">
                {s.description}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`${enabled ? "Disable" : "Enable"} ${s.label}`}
              onClick={() => toggle(s.id)}
              disabled={pending}
              className={`relative shrink-0 inline-flex h-6 w-11 rounded-full transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                enabled
                  ? "bg-[var(--accent)]"
                  : "bg-[var(--border-strong)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
