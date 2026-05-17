import type { SourceAdapter } from "../types";
import { searchHasgeekEvents } from "./search";

export const hasgeekAdapter: SourceAdapter = {
  id: "hasgeek",
  label: "HasGeek",
  description: "Curated tech conferences and meetups on hasgeek.com",
  async searchEvents({ location }) {
    try {
      return await searchHasgeekEvents(location);
    } catch {
      return [];
    }
  },
};
