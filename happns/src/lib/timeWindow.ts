import type { Event } from "./sources/types";

export type TimeWindowId = "any" | "today" | "week" | "weekend" | "month";

export interface TimeWindow {
  id: TimeWindowId;
  label: string;
}

export const TIME_WINDOWS: TimeWindow[] = [
  { id: "any", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "weekend", label: "This weekend" },
  { id: "month", label: "This month" },
];

const TIME_WINDOW_IDS = new Set<TimeWindowId>(TIME_WINDOWS.map((w) => w.id));

/**
 * Parse the `when` query param. Returns `null` when the param is absent so
 * the caller can apply a default; returns the parsed id otherwise (falling
 * back to `"any"` for unknown values).
 */
export function parseTimeWindow(
  raw: string | string[] | undefined,
): TimeWindowId | null {
  if (raw === undefined) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === "") return null;
  return TIME_WINDOW_IDS.has(v as TimeWindowId) ? (v as TimeWindowId) : "any";
}

export const DEFAULT_TIME_WINDOW: TimeWindowId = "week";

interface DateRange {
  start: Date;
  end: Date | null;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function getDateRange(window: TimeWindowId, now = new Date()): DateRange {
  const today = startOfDay(now);
  switch (window) {
    case "any":
      return { start: today, end: null };
    case "today":
      return { start: today, end: addDays(today, 1) };
    case "week":
      return { start: today, end: addDays(today, 7) };
    case "month":
      return { start: today, end: addDays(today, 30) };
    case "weekend": {
      const day = today.getDay();
      let start: Date;
      let end: Date;
      if (day === 6) {
        start = today;
        end = addDays(today, 2);
      } else if (day === 0) {
        start = today;
        end = addDays(today, 1);
      } else {
        const daysToSat = 6 - day;
        start = addDays(today, daysToSat);
        end = addDays(start, 2);
      }
      return { start, end };
    }
  }
}

export function filterByTimeWindow(
  events: Event[],
  window: TimeWindowId,
): Event[] {
  if (window === "any") return events;
  const range = getDateRange(window);
  const startMs = range.start.getTime();
  const endMs = range.end ? range.end.getTime() : Infinity;
  return events.filter((e) => {
    const t = new Date(e.dateTime).getTime();
    if (Number.isNaN(t)) return false;
    return t >= startMs && t < endMs;
  });
}
