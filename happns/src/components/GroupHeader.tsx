import type { Group } from "@/lib/sources/types";

interface GroupHeaderProps {
  group: Group;
}

export function GroupHeader({ group }: GroupHeaderProps) {
  const location = [group.city, group.country?.toUpperCase()]
    .filter(Boolean)
    .join(", ");

  return (
    <header className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8 mb-10">
      <div className="flex items-start gap-4 mb-5">
        <div className="size-12 sm:size-14 shrink-0 rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] flex items-center justify-center text-white font-semibold text-xl">
          {group.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight">
            {group.name}
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)] mt-2">
            {location ? <span>{location}</span> : null}
            {typeof group.memberCount === "number" ? (
              <span>
                {group.memberCount.toLocaleString()}{" "}
                {group.memberCount === 1 ? "member" : "members"}
              </span>
            ) : null}
            {typeof group.upcomingEventCount === "number" ? (
              <span>
                {group.upcomingEventCount} upcoming{" "}
                {group.upcomingEventCount === 1 ? "event" : "events"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {group.topics && group.topics.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {group.topics.map((t) => (
            <span
              key={t}
              className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)] font-medium"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}

      {group.description ? (
        <p className="text-[var(--foreground)] whitespace-pre-line leading-relaxed clamp-6">
          {group.description}
        </p>
      ) : null}
    </header>
  );
}
