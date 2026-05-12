import { loadEnv, saveEnv } from "../config.ts";

export const BASE_URL = "https://portal.mediassist.in";
export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Sliding session refresh; ASP.NET sessions typically expire after 20 min of inactivity. */
const SESSION_TTL_MS = 20 * 60 * 1000;

export class SessionExpiredError extends Error {
  constructor(message = "Medi Assist session expired — please login again") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type CookieJar = Map<string, string>;

function parseCookieString(str: string): CookieJar {
  const jar: CookieJar = new Map();
  if (!str) return jar;
  for (const part of str.split(/;\s*/)) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    jar.set(part.slice(0, eq).trim(), part.slice(eq + 1));
  }
  return jar;
}

function serializeCookieJar(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Merge Set-Cookie headers from a response into the jar.
 * `fetch` exposes Set-Cookie via the `getSetCookie()` method on the Headers object.
 */
function mergeSetCookies(jar: CookieJar, res: Response): void {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const first = sc.split(";")[0];
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1);
    jar.set(name, value);
  }
}

/**
 * Heuristic: if a response that should be JSON is actually an HTML login page,
 * the session has expired. ASP.NET commonly does this for ASMX endpoints when
 * forms-auth times out.
 */
function looksLikeLoginHtml(body: string): boolean {
  const head = body.slice(0, 2048).toLowerCase();
  return (
    head.includes("<!doctype") &&
    (head.includes('name="userid"') ||
      head.includes('id="username"') ||
      head.includes("forgotusername"))
  );
}

export class MediAssistClient {
  private jar: CookieJar;

  constructor(cookieString?: string) {
    this.jar = parseCookieString(cookieString ?? loadEnv().MEDIASSIST_COOKIE ?? "");
  }

  get cookieString(): string {
    return serializeCookieJar(this.jar);
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }

  hasSessionCookie(): boolean {
    return this.jar.has("ASP.NET_SessionId") || this.jar.size > 0;
  }

  /**
   * Persist current cookies + sliding expiry to .env.
   */
  persist(username?: string): void {
    saveEnv({
      ...(username ? { MEDIASSIST_USER: username } : {}),
      MEDIASSIST_COOKIE: this.cookieString,
      MEDIASSIST_COOKIE_EXPIRES_AT: String(Date.now() + SESSION_TTL_MS),
    });
  }

  clearSession(): void {
    this.jar.clear();
    saveEnv({
      MEDIASSIST_COOKIE: "",
      MEDIASSIST_COOKIE_EXPIRES_AT: "",
    });
  }

  private resolveUrl(path: string): string {
    return path.startsWith("http") ? path : new URL(path, BASE_URL).toString();
  }

  async request(
    path: string,
    init: RequestInit & { followRedirects?: boolean } = {},
  ): Promise<Response> {
    const url = this.resolveUrl(path);
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", DEFAULT_UA);
    if (!headers.has("Accept")) headers.set("Accept", "*/*");
    if (this.jar.size > 0) headers.set("Cookie", this.cookieString);

    const res = await fetch(url, {
      ...init,
      headers,
      redirect: init.followRedirects === false ? "manual" : "follow",
    });

    mergeSetCookies(this.jar, res);
    return res;
  }

  /**
   * POST a JSON body to an ASMX-style endpoint and parse the `{ d: "..." }` envelope.
   * The Medi Assist portal returns its JSON payload as a string inside `d`.
   */
  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(body ?? {}),
    });

    const text = await res.text();

    if (looksLikeLoginHtml(text)) throw new SessionExpiredError();
    if (!res.ok) throw new ApiError(`POST ${path} failed`, res.status, text.slice(0, 500));

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(`Invalid JSON from ${path}`, res.status, text.slice(0, 500));
    }
    // ASMX envelope: { d: "<stringified-json>" } or { d: <object> }
    if (parsed && typeof parsed === "object" && "d" in parsed) {
      const inner = (parsed as { d: unknown }).d;
      if (typeof inner === "string") {
        try {
          return JSON.parse(inner) as T;
        } catch {
          return inner as unknown as T;
        }
      }
      return inner as T;
    }
    return parsed as T;
  }

  async getText(path: string): Promise<string> {
    const res = await this.request(path);
    const text = await res.text();
    if (looksLikeLoginHtml(text)) throw new SessionExpiredError();
    if (!res.ok) throw new ApiError(`GET ${path} failed`, res.status, text.slice(0, 500));
    return text;
  }
}
