import { NextResponse, type NextRequest } from "next/server";
import { LAST_LOCATION_COOKIE } from "@/lib/locationPrefs";

/**
 * On a bare `/events` visit (no `location` query param at all), bounce to the
 * user's last-used city if one was remembered. Server-component `redirect()`
 * in Next.js 16 inlines into the RSC payload rather than emitting a real
 * HTTP redirect, which causes a flash on cold page loads. Doing the redirect
 * at the proxy layer gives us a real 308 with no flash.
 *
 * Next.js 16 renamed `middleware` → `proxy`; the framework picks up this file
 * at `src/proxy.ts` regardless of the exported function name.
 */
export function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (pathname !== "/events") return NextResponse.next();
  if (searchParams.has("location")) return NextResponse.next();

  const last = req.cookies.get(LAST_LOCATION_COOKIE)?.value;
  if (!last) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.searchParams.set("location", last);
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/events"],
};
