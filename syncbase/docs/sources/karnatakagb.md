# `karnatakagb.bank.in` — Karnataka Gramin Bank

| | |
|---|---|
| Phase | re-evaluated from S7 |
| Status | 🔴 Static PDFs only — no listing format at all |
| Category | bank-auction (SARFAESI) |
| Scope | Karnataka — rural/regional branches |
| Last recon | 2026-05-17 |

## Behavior

Bootstrap-themed static HTML site. The `/sarfaesi/e-auction` page is a thin shell that links to individual PDFs hosted under `/public/auctions/*.pdf`. There's no listing, no search, no metadata exposed in the HTML beyond the file path.

## URL

- Page: `https://karnatakagb.bank.in/sarfaesi/e-auction`
- PDFs: `https://karnatakagb.bank.in/public/auctions/{filename}.pdf`

## Attempts log

| Attempt | Result |
|---|---|
| Static analysis of page HTML | Just bootstrap + one inline subscribe-form AJAX (`url:"https://karnatakagb.bank.in/subscribeme"`). No data API. |
| Static analysis of `/public/js/*.js` referenced | Standard jQuery/Bootstrap/Swiper/menu-aim libs. No data fetcher. |
| Probe `/sarfaesi/e-auction/feed`, `/auctions.xml`, `/rss` etc. | Did not probe individually — but no inline references either. |
| Visual inspection of links on the page | 11 distinct PDF links, none of them auction *listings* in the visible sample (mostly DICGC docs, code of conduct, calendars). The actual auction notices, when they exist, follow `/public/auctions/{borrower}.pdf`. |

## Recommended verdict

**Skip.** There's nothing structured to ingest. Even with a PDF parser we'd be guessing borrower names from filenames. Karnataka Gramin Bank is also not a PSB Alliance member, so its inventory isn't mirrored on `baanknet.com` — but it is a tiny inventory in absolute terms.

## Known limitations

- No structured listing in any format (no JSON, no XML, no inline data in HTML).
- The `/public/auctions/` directory isn't browsable (no Apache `mod_autoindex` listing).
