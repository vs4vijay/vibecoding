import type { SourceAdapter } from "../types";
import { searchLumaEvents } from "./search";

export const lumaAdapter: SourceAdapter = {
  id: "luma",
  label: "Luma",
  description: "Curated tech, AI and community events on luma.com",
  async searchEvents({ location }) {
    // Luma's /find equivalent is city pages — keyword filtering is not a URL
    // param. Keywords are ignored for now; we lean on the multi-source filter
    // chips client-side after merge.
    try {
      return await searchLumaEvents(location);
    } catch {
      return [];
    }
  },
};
