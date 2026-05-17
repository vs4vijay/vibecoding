"use client";

import { useEffect } from "react";
import { LAST_LOCATION_COOKIE } from "@/lib/locationPrefs";

interface RememberLocationProps {
  location: string;
}

/**
 * Persists the last-used location to a cookie so visiting `/events` bare can
 * auto-redirect to the user's most recent search. Mounted on the events page
 * only when a location is present in the URL.
 */
export function RememberLocation({ location }: RememberLocationProps) {
  useEffect(() => {
    if (!location) return;
    document.cookie =
      `${LAST_LOCATION_COOKIE}=${encodeURIComponent(location)}; ` +
      `path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
  }, [location]);
  return null;
}
