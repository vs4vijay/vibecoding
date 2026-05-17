"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { TIME_WINDOWS, type TimeWindowId } from "@/lib/meetup/timeWindow";

interface DateFilterProps {
  location: string;
  categories: string[];
  selected: TimeWindowId;
}

export function DateFilter({
  location,
  categories,
  selected,
}: DateFilterProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(id: TimeWindowId) {
    if (!location.trim()) return;
    const params = new URLSearchParams();
    params.set("location", location);
    if (categories.length > 0) params.set("categories", categories.join(","));
    if (id !== "any") params.set("when", id);
    startTransition(() => {
      router.push(`/events?${params.toString()}`);
    });
  }

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] mb-3">
        When
      </h3>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label="Time window"
        aria-busy={pending}
      >
        {TIME_WINDOWS.map((w) => {
          const active = selected === w.id;
          return (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => select(w.id)}
              disabled={pending || !location.trim()}
              className={`px-3 h-8 rounded-full text-sm border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]"
                  : "bg-[var(--surface)] text-[var(--foreground)] border-[var(--border)] hover:border-[var(--accent)]"
              }`}
            >
              {w.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
