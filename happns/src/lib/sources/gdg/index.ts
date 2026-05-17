import type { SourceAdapter } from "../types";
import { searchGdgEvents } from "./search";

export const gdgAdapter: SourceAdapter = {
  id: "gdg",
  label: "GDG",
  description: "Google Developer Groups chapters on gdg.community.dev",
  async searchEvents({ location }) {
    try {
      return await searchGdgEvents(location);
    } catch {
      return [];
    }
  },
};
