# `aubank.in/bank-auction`

| | |
|---|---|
| Phase | re-evaluated from S7 |
| Status | 🔴 Cloudflare Turnstile-walled + currently empty |
| Category | bank-auction (SARFAESI) |
| Scope | AU Small Finance Bank's branches |
| Last recon | 2026-05-17 |

## Behavior

Next.js page sitting behind a Cloudflare anti-bot challenge (Turnstile). Direct HTTP requests get a 403 challenge page that includes a `<title>Just a moment...</title>` and a `script-src 'nonce-…' 'unsafe-eval' https://challenges.cloudflare.com` CSP. The challenge requires JavaScript execution to pass.

When the page does render (in a real browser), the visible content is "No auctions available" — AU Small Finance Bank doesn't publish SARFAESI listings on this portal directly. Their SARFAESI inventory is mirrored on `bankeauctions.com` as `bank_id=223`, but with zero rows there too.

## URL

- Listing: `https://www.aubank.in/bank-auction` (redirects to `https://www.au.bank.in/bank-auction`)

## Attempts log

| Attempt | Result |
|---|---|
| `GET /bank-auction` from curl with a Chrome UA | 301 → `au.bank.in`, then 403 with `<title>Just a moment…</title>`. Body is the Cloudflare bot-challenge page. |
| Inspection of a manually rendered page (prior recon, 2026-05-14) | Rendered "No auctions available" — even with the challenge passed, there is no inventory. |
| Cross-reference with `bankeauctions.com?bank_id=223` | Zero rows for AU. The bank doesn't actively use either portal. |

## Recommended verdict

**Skip indefinitely.** Two compounding reasons: (a) Cloudflare Turnstile blocks non-browser clients, (b) there is no inventory to ingest anyway. Re-check only if (a) goes away AND (b) AU starts publishing.

## Known limitations

- Cloudflare Turnstile is non-bypassable from a non-browser context.
- AU's SARFAESI activity, when it happens, is routed through bankeauctions.com — already onboarded.
