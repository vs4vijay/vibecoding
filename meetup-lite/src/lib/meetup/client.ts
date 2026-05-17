const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export async function fetchMeetupHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      next: { revalidate: 600 },
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      throw new FetchError(
        `Meetup responded ${res.status}`,
        url,
        res.status,
      );
    }

    return await res.text();
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw new FetchError(
      err instanceof Error ? err.message : "network error",
      url,
    );
  }
}
