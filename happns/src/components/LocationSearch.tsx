"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface LocationSearchProps {
  defaultValue?: string;
  autoFocus?: boolean;
  size?: "md" | "lg";
  preserveCategories?: string[];
  preserveWhen?: string;
}

export function LocationSearch({
  defaultValue,
  autoFocus,
  size = "md",
  preserveCategories,
  preserveWhen,
}: LocationSearchProps) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? "");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    const params = new URLSearchParams({ location: trimmed });
    if (preserveCategories && preserveCategories.length > 0) {
      params.set("categories", preserveCategories.join(","));
    }
    if (preserveWhen && preserveWhen !== "any") {
      params.set("when", preserveWhen);
    }
    router.push(`/events?${params.toString()}`);
  }

  const isLg = size === "lg";
  const inputCls = isLg
    ? "h-14 pl-12 pr-4 text-base"
    : "h-11 pl-10 pr-4 text-sm";
  const btnCls = isLg ? "h-14 px-6 text-base" : "h-11 px-5 text-sm";
  const iconSize = isLg ? 20 : 16;
  const iconLeft = isLg ? "left-4" : "left-3";

  return (
    <form
      onSubmit={onSubmit}
      className="flex gap-2 w-full"
      role="search"
    >
      <div className="relative flex-1">
        <span
          className={`absolute ${iconLeft} top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none`}
        >
          <SearchIcon size={iconSize} />
        </span>
        <input
          type="text"
          name="location"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search a city — San Francisco, Bangalore…"
          autoFocus={autoFocus}
          className={`w-full ${inputCls} rounded-2xl bg-[var(--surface)] border border-[var(--border-strong)] focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)] transition`}
          aria-label="Location"
        />
      </div>
      <button
        type="submit"
        className={`${btnCls} rounded-2xl bg-[var(--accent)] hover:bg-[var(--accent-strong)] text-[var(--accent-foreground)] font-medium transition disabled:opacity-50`}
      >
        Search
      </button>
    </form>
  );
}

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
