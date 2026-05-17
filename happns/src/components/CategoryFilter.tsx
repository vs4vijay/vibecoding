"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CATEGORIES } from "@/lib/sources/meetup";

interface CategoryFilterProps {
  location: string;
  selected: string[];
  when?: string;
}

export function CategoryFilter({
  location,
  selected,
  when,
}: CategoryFilterProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const selectedSet = new Set(selected);

  function navigate(next: string[]) {
    const params = new URLSearchParams();
    params.set("location", location);
    // Always set the key so the server can tell "user explicitly chose nothing"
    // (sentinel `none`) apart from "key absent → apply default".
    params.set("categories", next.length > 0 ? next.join(",") : "none");
    if (when) params.set("when", when);
    startTransition(() => {
      router.push(`/events?${params.toString()}`);
    });
  }

  function toggle(id: string) {
    if (!location.trim()) return;
    const next = selectedSet.has(id)
      ? selected.filter((s) => s !== id)
      : [...selected, id];
    navigate(next);
  }

  function clear() {
    navigate([]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] flex items-center gap-2">
          Categories
          {selected.length > 0 ? (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-[10px] font-semibold rounded-full bg-[var(--accent)] text-[var(--accent-foreground)]">
              {selected.length}
            </span>
          ) : null}
        </h3>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-[var(--accent-strong)] hover:underline disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            disabled={pending}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div
        className="flex flex-wrap gap-2"
        aria-busy={pending}
        role="group"
        aria-label="Event categories"
      >
        {CATEGORIES.map((cat) => {
          const active = selectedSet.has(cat.id);
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => toggle(cat.id)}
              aria-pressed={active}
              disabled={pending || !location.trim()}
              className={`px-3 h-8 rounded-full text-sm border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]"
                  : "bg-[var(--surface)] text-[var(--foreground)] border-[var(--border)] hover:border-[var(--accent)]"
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
