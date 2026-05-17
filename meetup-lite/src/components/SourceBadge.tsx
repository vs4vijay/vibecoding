import { SOURCES } from "@/lib/sources/registry";
import type { SourceId } from "@/lib/sources/types";

const SOURCE_LABELS = new Map(SOURCES.map((s) => [s.id, s.label]));

const SOURCE_STYLES: Record<SourceId, string> = {
  meetup: "bg-red-500/90 text-white",
  luma: "bg-purple-600/90 text-white",
  gdg: "bg-blue-500/90 text-white",
  hasgeek: "bg-emerald-600/90 text-white",
};

interface SourceBadgeProps {
  source: SourceId;
  size?: "xs" | "sm";
}

export function SourceBadge({ source, size = "xs" }: SourceBadgeProps) {
  const label = SOURCE_LABELS.get(source) ?? source;
  const px = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center font-semibold uppercase tracking-wide rounded-md backdrop-blur ${px} ${SOURCE_STYLES[source] ?? "bg-neutral-700 text-white"}`}
    >
      {label}
    </span>
  );
}
