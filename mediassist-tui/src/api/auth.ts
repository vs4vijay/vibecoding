import { loadEnv } from "../config.ts";
import { MediAssistClient, SessionExpiredError } from "./client.ts";

/**
 * Extracts ASP.NET WebForms hidden fields from a login page.
 */
function extractFormFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]+name="(__[A-Z]+)"[^>]+value="([^"]*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

/**
 * Performs the login POST. Returns the client (with cookies populated) on success.
 * Throws on bad credentials or unexpected response.
 */
export async function login(username: string, password: string): Promise<MediAssistClient> {
  const client = new MediAssistClient("");

  // Step 1: GET login page → grab VIEWSTATE + session cookie
  const loginHtml = await client.getText("/Home.aspx");
  const fields = extractFormFields(loginHtml);
  if (!fields.__VIEWSTATE) {
    throw new Error("Could not parse login page (no __VIEWSTATE found)");
  }

  // Step 2: POST credentials
  const form = new URLSearchParams();
  form.set("__VIEWSTATE", fields.__VIEWSTATE);
  form.set("__VIEWSTATEGENERATOR", fields.__VIEWSTATEGENERATOR ?? "");
  if (fields.__EVENTVALIDATION) form.set("__EVENTVALIDATION", fields.__EVENTVALIDATION);
  form.set("USERID", username);
  form.set("PASSWORD", password);

  const res = await client.request("/Home.aspx", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://portal.mediassist.in/Home.aspx",
    },
    body: form.toString(),
    followRedirects: false,
  });

  // Successful login typically responds with a 302 to indexmicrosoft1.aspx (or similar).
  // Failure stays on Home.aspx with an error message in HTML.
  if (res.status === 302 || res.status === 303) {
    client.persist(username);
    return client;
  }

  if (res.status === 200) {
    const body = await res.text();
    // Heuristic: re-render of login page with an error
    if (/invalid|incorrect|locked|wrong\s+password|user\s*name/i.test(body)) {
      throw new Error("Login failed: invalid username or password");
    }
    // Some setups return 200 with a redirect script — treat as success if cookies are set.
    if (client.hasSessionCookie()) {
      client.persist(username);
      return client;
    }
  }

  throw new Error(`Login failed (HTTP ${res.status})`);
}

/**
 * Loads a client from .env cookies, then probes a cheap authenticated endpoint
 * to verify the session is still valid. Returns null if no session is stored
 * or it has expired.
 */
export async function loadSession(): Promise<MediAssistClient | null> {
  const env = loadEnv();
  if (!env.MEDIASSIST_COOKIE) return null;

  const expiresAt = env.MEDIASSIST_COOKIE_EXPIRES_AT
    ? Number(env.MEDIASSIST_COOKIE_EXPIRES_AT)
    : 0;
  if (expiresAt && Date.now() > expiresAt) return null;

  const client = new MediAssistClient(env.MEDIASSIST_COOKIE);
  try {
    // Probe: fetch the user profile page; if session is dead it returns the login HTML.
    await client.getText("/UserProfile.aspx");
    client.persist();
    return client;
  } catch (err) {
    if (err instanceof SessionExpiredError) return null;
    throw err;
  }
}

export function logout(): void {
  new MediAssistClient("").clearSession();
}
