# `mstcecommerce.com/auctionhome/customs/{welcome,index}.jsp`

| | |
|---|---|
| Phase | re-evaluated from S7 |
| Status | 🔴 Login portal — listings are behind authentication |
| Category | govt-customs (MSTC platform for customs disposal) |
| Scope | All-India |
| Last recon | 2026-05-17 |

## Behavior

These two URLs are part of MSTC's customs auction platform, but they are **just the login screen and the static landing page** — not listings. The page title gives it away: *"Portal for Customs E-Auction/E-Tender"* with a centered `<h2>Login</h2>` form. The actual customs lot listings sit behind the MSTC bidder login.

## URLs

- `https://mstcecommerce.com/auctionhome/customs/welcome.jsp` — static landing
- `https://mstcecommerce.com/auctionhome/customs/index.jsp` — login form

## Attempts log

| Attempt | Result |
|---|---|
| Visual inspection of `index.jsp` HTML | Login form (`<h2>Login</h2>`). No listing, no link to an unauthenticated list. |
| Visual inspection of `welcome.jsp` HTML | Static text + register link (`../mstc/register`). |
| Look for any inline data fetch | None — just the auth JS (`jsencrypt.js`, `mstccaptcha.js`). |

## Recommended verdict

**Skip.** There is no public listing here, only a login. Customs lots on the MSTC platform are reachable through the **`mstcindia.co.in` Forthcoming endpoint** (see [`mstcindia.md`](./mstcindia.md)) — that's the unauthenticated mirror of the same data.

## Known limitations

- Even with a bidder login, scraping would violate MSTC's ToS. Out of scope.
