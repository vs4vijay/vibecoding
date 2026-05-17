import { parse, type HTMLElement } from "node-html-parser";

export interface HasgeekRawEvent {
  /** Slug path relative to hasgeek.com (e.g. "/rootconf/database-conf-cfp/"). */
  href: string;
  /** Aria-label on the anchor — the cleanest source for the title. */
  title: string;
  /** Subtitle/tagline shown under the bold title in the card body. */
  subtitle?: string;
  /** Brand / series name (e.g. "Rootconf", "Tech4Food"). */
  series?: string;
  /** First `data-event-date="YYYY-MM-DD"` attribute found. */
  startDate?: string;
  /** Last `data-event-date="YYYY-MM-DD"` attribute found, if multi-day. */
  endDate?: string;
  /** First `<span class="calendar__weekdays__dates__time">` text. */
  timeRange?: string;
  /** Raw aria-label text from the date wrapper: "22 May 2026, Location, City". */
  ariaLabel?: string;
  /** Trailing text after the map-pin icon in card__body__location. */
  location?: string;
  /** Lazy-loaded card image. */
  imageUrl?: string;
}

/**
 * Parse the upcoming-events list on hasgeek.com.
 *
 * Each card is an `<a class="card card--upcoming">`. We pull the cleanest
 * signal from each spot:
 * - Title: anchor `aria-label`
 * - Date: `data-event-date` attrs on the inline calendar (most precise)
 * - Time: first `.calendar__weekdays__dates__time`
 * - Location: `.card__body__location` text content
 * - Series: the first bold subhead span inside the card header
 */
export function parseHasgeekUpcoming(html: string): HasgeekRawEvent[] {
  const root = parse(html);
  const cards = root.querySelectorAll("a.card.card--upcoming");
  const events: HasgeekRawEvent[] = [];

  for (const card of cards) {
    const href = card.getAttribute("href") ?? "";
    const title = (
      card.getAttribute("aria-label") ??
      card.getAttribute("data-cy-title") ??
      ""
    ).trim();
    if (!href || !title) continue;

    events.push({
      href,
      title,
      subtitle: extractSubtitle(card),
      series: extractSeries(card),
      ...extractDateRange(card),
      ariaLabel: extractAriaLabel(card),
      location: extractLocation(card),
      imageUrl: extractImage(card),
    });
  }
  return events;
}

function extractSubtitle(card: HTMLElement): string | undefined {
  // Title is "<bold>Series: Title</bold> <light>Subtitle</light>" — grab the
  // truncated light span.
  const span = card.querySelector(
    ".card__body__title .mui--text-light.js-truncate",
  );
  const text = span?.text?.trim();
  return text || undefined;
}

function extractSeries(card: HTMLElement): string | undefined {
  // The series name lives in the header strip as a bold subhead span.
  const span = card.querySelector(
    "span.mui--text-dark.mui--text-subhead.text-bold",
  );
  const text = span?.text?.trim();
  return text || undefined;
}

function extractDateRange(
  card: HTMLElement,
): Pick<HasgeekRawEvent, "startDate" | "endDate" | "timeRange"> {
  const activeDays = card.querySelectorAll("[data-event-date]");
  const dates: string[] = [];
  for (const d of activeDays) {
    const v = d.getAttribute("data-event-date");
    if (v) dates.push(v);
  }
  dates.sort();
  const start = dates[0];
  const end = dates.length > 1 ? dates[dates.length - 1] : undefined;
  const time = card
    .querySelector(".calendar__weekdays__dates__time")
    ?.text?.trim();
  return {
    startDate: start,
    endDate: end,
    timeRange: time || undefined,
  };
}

function extractAriaLabel(card: HTMLElement): string | undefined {
  // The wrapper div around the calendar has an aria-label with a human-
  // readable summary: "22 May 2026, Fandom at Gilly's Redefined, Bengaluru".
  const wrappers = card.querySelectorAll(".card__body div[aria-label]");
  for (const w of wrappers) {
    const label = w.getAttribute("aria-label")?.trim();
    if (label && /\d/.test(label)) return label;
  }
  return undefined;
}

function extractLocation(card: HTMLElement): string | undefined {
  const loc = card.querySelector(".card__body__location");
  if (!loc) return undefined;
  // The element holds the SVG icon plus the text. Strip the SVG.
  for (const svg of loc.querySelectorAll("svg")) svg.remove();
  const text = loc.text.trim().replace(/,$/, "").trim();
  return text || undefined;
}

function extractImage(card: HTMLElement): string | undefined {
  const img = card.querySelector(".card__image");
  if (!img) return undefined;
  const src =
    img.getAttribute("data-src") ?? img.getAttribute("src") ?? undefined;
  if (!src) return undefined;
  // Skip the generic default banner placeholder.
  if (src.includes("default-banner")) return undefined;
  return src;
}
