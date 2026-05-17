"use client";

import { useSavedEvents } from "@/lib/saved";

interface SaveButtonProps {
  event: {
    id: string;
    groupSlug: string;
    title: string;
    dateTime: string;
  };
  variant?: "icon" | "button";
  tone?: "default" | "overlay";
}

export function SaveButton({
  event,
  variant = "icon",
  tone = "default",
}: SaveButtonProps) {
  const { isSaved, toggleSaved } = useSavedEvents();
  const saved = isSaved(event.groupSlug, event.id);

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    toggleSaved(event);
  }

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={saved}
        className={`inline-flex items-center gap-2 px-4 h-10 rounded-xl text-sm font-medium border transition ${
          saved
            ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)] hover:bg-[var(--accent-strong)]"
            : "bg-[var(--surface)] text-[var(--foreground)] border-[var(--border-strong)] hover:border-[var(--accent)]"
        }`}
      >
        <BookmarkIcon filled={saved} />
        {saved ? "Saved" : "Save"}
      </button>
    );
  }

  const overlayBase =
    "size-8 inline-flex items-center justify-center rounded-full bg-[var(--surface)]/90 backdrop-blur border border-[var(--border)] hover:bg-[var(--surface)] transition";
  const defaultBase =
    "size-8 inline-flex items-center justify-center rounded-full hover:bg-[var(--surface-elevated)] transition";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={saved ? "Unsave event" : "Save event"}
      aria-pressed={saved}
      className={`${tone === "overlay" ? overlayBase : defaultBase} ${
        saved ? "text-[var(--accent)]" : "text-[var(--foreground)]"
      }`}
    >
      <BookmarkIcon filled={saved} />
    </button>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}
