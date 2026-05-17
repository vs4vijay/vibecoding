import { getEvent } from "./event";
import { getGroup } from "./group";
import { searchEventsByCategories } from "./search";
import type { SourceAdapter } from "@/lib/sources/types";

export const meetupAdapter: SourceAdapter = {
  id: "meetup",
  label: "Meetup",
  description: "Public events and groups on meetup.com",
  async searchEvents({ location, keywords }) {
    try {
      return await searchEventsByCategories(location, keywords ?? []);
    } catch {
      return [];
    }
  },
  async getEvent(slug, eventId) {
    try {
      return await getEvent(slug, eventId);
    } catch {
      return null;
    }
  },
  async getGroup(slug) {
    try {
      return await getGroup(slug);
    } catch {
      return null;
    }
  },
};

export {
  CATEGORIES,
  DEFAULT_CATEGORY_IDS,
  getCategory,
  parseCategoryIds,
} from "./categories";
