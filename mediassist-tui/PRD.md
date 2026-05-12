# Medi Assist TUI — Product Requirements Document

## 1. Overview

A terminal UI (TUI) for the Medi Assist insurance portal (`portal.mediassist.in`) that lets a corporate insured user view their policy, browse claims, and submit new OPD reimbursement claims directly from the command line. Claim form fields are auto-extracted from a PDF or image invoice using the Claude API, reducing manual data entry.

**Target user:** Microsoft employee covered under the Medi Assist group policy who submits multiple small OPD bills (consultations, pharmacy, vision/dental) and wants to skip the slow, brittle web form.

## 2. Goals

- **Eliminate manual form filling** — drop a PDF/image, review extracted fields, submit.
- **Avoid the portal's known UX issues** — JS errors, stuck spinners, Google Maps autocomplete failures (which we hit in initial automation attempts).
- **Persistent session** — login once, reuse cookie until expiry.
- **Fast at-a-glance status** — current sum insured, remaining balance, recent claim states without navigating multiple pages.

## 3. Non-Goals

- Hospitalization (Domiciliary) claims — OPD only in v1.
- Multi-user / family member switching beyond what the policy allows for a single login.
- Claim editing after submission, draft management UI (drafts may be supported behind the scenes but no dedicated UI).
- Mobile / web frontend.

## 4. User Flows

### 4.1 First run (no session)
1. App detects missing `MEDIASSIST_COOKIE` in `.env`.
2. Prompts: `Username:` `Password:` (password masked).
3. Performs ASP.NET WebForms login (parse `__VIEWSTATE` → POST credentials).
4. On success: saves `MEDIASSIST_USER`, `MEDIASSIST_COOKIE`, `MEDIASSIST_COOKIE_EXPIRES_AT` to `.env`.
5. Drops into Dashboard.

### 4.2 Subsequent runs
1. Reads `.env`. If cookie exists and `MEDIASSIST_COOKIE_EXPIRES_AT > now`, attempt a lightweight authenticated call to validate.
2. If valid → Dashboard.
3. If invalid or expired → re-show login prompt → save new cookie → Dashboard.

### 4.3 Dashboard
Shows:
- Policy holder name + policy number
- Sum insured / available balance
- Beneficiaries (self + dependents)
- Last 5 claims with status

Actions:
- `N` — New Claim
- `C` — Browse Claims
- `R` — Refresh
- `L` — Logout (clears cookie from .env)
- `Q` — Quit

### 4.4 New Claim flow
1. **Pick file** — file path input (PDF / JPG / PNG).
2. **Extract** — Claude API reads document, returns structured `ClaimFields`.
3. **Review** — Ink form pre-filled with extracted values; user can edit any field, especially:
   - Beneficiary (self / family — fetched from policy)
   - Bill type (dropdown from `/OPDClaimSubmission.aspx/GetbillTypeList`)
   - Pincode → triggers locality lookup
   - Hospital/Clinic name
4. **Confirm** → submits via the API chain (add bill → upload doc → submit claim).
5. Shows claim reference number.

### 4.5 Claims List
- Paginated table of past claims: date, beneficiary, bill type, amount, status.
- Drill-in shows full breakdown.

## 5. Document Extraction (Local — no cloud APIs)

All extraction runs **locally** on the user's machine. No PDF/image data is sent to any third-party service.

**Input:** local file path (PDF, JPG, PNG, TIFF — same set the portal accepts).

**Output schema:**
```ts
type ClaimFields = {
  billType: BillType;          // best-guess from Vision&Dental / Pharmacy / OPD-Consultation / etc.
  billAmount: number;          // in INR
  billNumber: string;
  billDate: string;            // DD-MM-YYYY
  clinicName: string;
  pincode?: string;            // derived from address if visible
  natureOfIllness: string;     // short free-text, e.g., "Vision correction - prescription lens"
  beneficiaryHint?: string;    // patient name from invoice → matched to a beneficiary
  rawText: string;             // for fallback/review
  confidence: Partial<Record<keyof ClaimFields, number>>; // 0..1 per field
};
```

### Pipeline

```
file path
   │
   ▼
┌───────────────┐  PDF with text layer
│ pdfDetector   │─────────────────────────┐
└──────┬────────┘                         │
       │  image / scanned PDF             │
       ▼                                  ▼
┌────────────────┐                ┌──────────────┐
│ tesseract.js   │                │   unpdf      │
│ (OCR, eng+hin) │                │ (text)       │
└──────┬─────────┘                └──────┬───────┘
       │                                  │
       └────────────────┬────────────────┘
                        ▼
              ┌──────────────────────┐
              │ regex/heuristic      │   covers vendor name, invoice no,
              │ extractor            │   date, amount, GST, pincode.
              └──────────┬───────────┘
                         │  fields still missing or low confidence?
                         ▼
              ┌──────────────────────┐
              │ Ollama LLM (opt-in)  │   POST /api/chat with JSON-mode
              │ qwen2.5:3b / nuext.  │   schema; fills the gaps.
              └──────────┬───────────┘
                         ▼
                    ClaimFields
```

### Pluggable engine architecture

The extraction pipeline is split into **three swappable engine roles** behind narrow TypeScript interfaces (see `src/engines/types.ts`). New backends (MarkItDown, PaddleOCR, native Tesseract, Anthropic, OpenAI, local Qwen, etc.) plug in without touching the orchestrator.

| Role | Interface | Default impl | Future drop-ins |
|---|---|---|---|
| **TextExtractor** — PDF/document → text | `extract(file) → { text, hasTextLayer }` | `unpdf` | `markitdown`, `pdfjs-dist`, `pandoc` |
| **OcrEngine** — image → text | `recognize(file) → string` | `tesseract.js` | `paddleocr`, native `tesseract`, cloud OCR |
| **FieldExtractor** — text → ClaimFields | `extract(text, partial?) → ClaimFields` | `heuristic` (regex + templates), `ollama` (chain) | `anthropic`, `openai`, `local-qwen` via llama.cpp, `nuextract` |

Engines are selected via `.env`:
```bash
TEXT_EXTRACTOR=unpdf                # default
OCR_ENGINE=tesseract                # default
FIELD_EXTRACTORS=heuristic,ollama   # chain — engines run in order until confidence is high enough
```

Registering a new engine is one line in `src/engines/registry.ts`:
```ts
registerFieldExtractor("anthropic", anthropicFieldExtractor);
```

`registry.ts` exposes `registerTextExtractor`, `registerOcrEngine`, `registerFieldExtractor` for plugin-style extension.

### Library choices (current implementations, researched 2026)

| Default | Why |
|---|---|
| **`unpdf`** | Serverless build of pdf.js; no native deps (avoids `canvas` build pain on Windows); Bun-friendly. |
| **`tesseract.js`** v6+ | Pure WASM (no `tesseract.exe` install); supports eng + Devanagari traineddata. |
| **Ollama** (`qwen2.5:3b` / `nuextract`) | Localhost HTTP API, JSON-mode structured outputs. Off by default; opt-in by setting `OLLAMA_HOST` in `.env`. |

### Extraction strategy

1. **Detect type**: if the PDF has an embedded text layer (`unpdf` returns > N words), skip OCR.
2. **Run regex pass first** — invoices are highly structured. Patterns to look for:
   - Invoice/Bill No: `(?:Invoice|Bill)\s*(?:No|Number|#)\.?\s*:?\s*(\S+)`
   - Date: `\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b` (Indian formats DD-MM-YYYY preferred)
   - Total amount: largest currency value or label `Grand Total|Total|Amount`
   - GST: `GST(?:IN)?\s*[:#]?\s*([A-Z0-9]{15})`
   - Pincode: `\b([1-9]\d{5})\b`
   - Patient name: line after `Name:` label
3. **Heuristic bill-type classification** based on vendor keywords (e.g., "Optical" → Vision & Dental, "Pharma|Medicines" → Pharmacy & Medicines).
4. **LLM fallback** — if user enables `OLLAMA_HOST` in `.env`, the extractor POSTs the raw text + schema to Ollama for any fields the regex pass didn't fill or marked low-confidence.
5. **Always show editable review screen** in the TUI — the user is the final authority.

### Out-of-the-box vs Ollama mode

- **Default**: regex/heuristic only. Works on the sample invoices we have (Arjun Optical, Augmenta Health) which follow predictable templates. Zero setup.
- **Ollama mode**: enabled when `OLLAMA_HOST=http://localhost:11434` is set in `.env`. Used as a fallback for messy/handwritten/low-OCR-quality docs. User must `ollama pull qwen2.5:3b` separately.

## 6. Medi Assist APIs (verified)

All endpoints share `portal.mediassist.in` host. Most require an authenticated session cookie (`ASP.NET_SessionId` + forms-auth). Two distinct request styles are used:

- **Form-encoded** (`application/x-www-form-urlencoded`) for `/ServiceCalls/*.aspx` endpoints — return plain JSON.
- **JSON** (`application/json; charset=utf-8`) for ASMX-style `*.aspx/<MethodName>` endpoints — return `{ "d": "<json-string>" }` envelope.

### 6.1 Auth ✅ verified
| Endpoint | Method | Notes |
|---|---|---|
| `/Home.aspx` | GET | Returns login page; parse `__VIEWSTATE`, `__VIEWSTATEGENERATOR` |
| `/Home.aspx` | POST (form) | Login: `USERID`, `PASSWORD`, `__VIEWSTATE`, `__VIEWSTATEGENERATOR`. Success → 302 redirect + auth cookies. |
| `/Logout.aspx` | GET | Logout |

### 6.2 Policy & Beneficiaries ✅ verified
| Endpoint | Method | Notes |
|---|---|---|
| `/ServiceCalls/GetPolicies.aspx` | POST (form, empty body works) | Returns `{ Policies: [{ Beneficiaries: [...] }] }`. Each Beneficiary has `CMS*` fields including `CMSFamilySumInsured`, `CMSFamilyBalanceSumInsured`, `CMSFamilyDomiLimit`, `CMSFamilyDomiBalance`, `CMSMemberName`, `CMSMemberRelation`, `CMSMemberDOB`, `CMSEmployeeCode`, `CMSPriBenefId`, etc. |
| `/ServiceCalls/GetPolicies.aspx/GetUserWalletDetails` | POST | Wallet view (alternative; same shape) |
| `/ServiceCalls/GetPolicies.aspx/GetBenefDetailsWF` | POST | Workflow-specific beneficiary view |

❌ **Avoid:** `/Policy.aspx/FetchBenefDatafromElastic` — this is the **HR employee search** endpoint, not the user's own policy. Returns 500 without a `searchedName` payload.

### 6.3 Entities (the user's employers/sub-orgs) ✅ verified
| Endpoint | Method | Notes |
|---|---|---|
| `/Claims.aspx?LoadEntity=true` | GET | Returns plain JSON array `[{ entityId, entityName, entityCode }]`. Required as `entityids` filter on claims list. Note: name is misleading — this returns **entities**, not claims. |

### 6.4 Claims List ✅ verified
| Endpoint | Method | Notes |
|---|---|---|
| `/ServiceCalls/GetClaims.aspx` | POST (form) | Body fields: `employeeCode`, `claimType`, `mobileNumber`, `fromDate` (ISO), `toDate` (ISO), `entityids` (JSON-stringified array), `searchDateType`. Returns `{ ErrorMessage, IsSuccess, SearchResults: [...] }`. Each result has `IWPClaimNumber`, `CMSClaimId`, `BeneficiaryName`, `BenefRelation`, `ClaimedAmount`, `ApprovedAmount`, `ClaimStatus`, `ClaimSubmissionTime`, `ClaimType`, `Ailment`. |
| `/ServiceCalls/GetClaimDetails.aspx` | POST (form) | Single claim drill-in |
| `/ServiceCalls/CancelClaim.aspx` | POST | Cancel a pending claim |

### 6.5 Lookups (claim form)
| Endpoint | Method | Notes |
|---|---|---|
| `/OPDClaimSubmission.aspx/GetbillTypeList` | POST (JSON) | Bill type dropdown options |
| `/OPDClaimSubmission.aspx/GetLocation` | POST (JSON) | Pincode → city/state |
| `/NewClaimSubmission_New.aspx/GetPincodeData` | POST (JSON) | Alt pincode lookup |
| `/ClaimSubmission.aspx/networkHospitals` | POST (JSON) | Hospital search |
| `/DomiClaimSubmission.aspx/CheckIsDuplicateClaim` | POST (JSON) | Duplicate guard |

### 6.6 Claim Submission (OPD)
| Endpoint | Method | Notes |
|---|---|---|
| `/ServiceCalls/AddClaimBill.aspx` | POST (form) | Add one bill line |
| `/ServiceCalls/RemoveClaimBill.aspx` | POST (form) | Remove a bill |
| `/ServiceCalls/SaveDraft.aspx` | POST (form) | Save current state as draft |
| `/ServiceCalls/GetClaimDraft.aspx` | GET | Resume draft |
| `/ServiceCalls/SubmitClaim.aspx` | POST (form) | Final submit |
| `/fileuploaddomi2.aspx` | POST (multipart) | Document upload |
| `/OPDClaimSubmission.aspx?checkUpload=true` | GET | Upload sanity check |

### 6.7 Bank / Profile
| Endpoint | Method | Notes |
|---|---|---|
| `/UserProfile.aspx/GetBankDetail` | POST (JSON) | Bank account for reimbursement |
| `/ServiceCalls/GetUserBankDetails.aspx` | GET | Alt bank details (returns HTML for ServiceCalls path so this is unreliable; prefer the JSON endpoint) |

### 6.8 Response envelope notes
- `/ServiceCalls/*` endpoints return **plain JSON** (no `{ d: ... }` wrapper). Even though the response `content-type` is sometimes `text/html`, the body is parseable JSON.
- `/*.aspx/<Method>` ASMX endpoints return `{ d: "<json-string>" }` — the `d` field must be JSON-parsed a second time.
- Session expiry typically returns the login HTML page with HTTP 200 — detect via content sniffing, not status code.

## 7. Bill Type Options (observed)
- Vision & Dental
- Vaccination
- Pharmacy & Medicines
- OPD-Consultation
- Investigation & Labs
- Investigation & Lab Charges
- Health Check Up

## 8. Architecture

```
mediassist-tui/
├── PRD.md                         # this file
├── README.md
├── package.json                   # Bun + Ink + @clack/prompts + unpdf + tesseract.js
├── tsconfig.json
├── .env / .env.example
├── src/
│   ├── index.ts                   # TUI entry point
│   ├── cli.ts                     # CLI commands (login / policy / claims / extract / submit)
│   ├── config.ts                  # env loading + .env writer
│   ├── types.ts                   # shared types (ClaimFields, Policy, Claim, etc.)
│   ├── api/
│   │   ├── client.ts              # fetch wrapper, cookie jar, base URL, SessionExpiredError
│   │   ├── auth.ts                # login (VIEWSTATE parse → POST), logout, loadSession probe
│   │   ├── user.ts                # entity list, user context
│   │   ├── policy.ts              # GetPolicies.aspx → Policy + OPD balance + beneficiaries
│   │   ├── claims.ts              # GetClaims.aspx → list; AddClaimBill + SubmitClaim
│   │   └── lookups.ts             # pincode, bill types, hospital search
│   ├── engines/                   # pluggable extraction engines
│   │   ├── types.ts               # TextExtractor / OcrEngine / FieldExtractor interfaces
│   │   ├── registry.ts            # named registries + getters; env-driven selection
│   │   ├── text/
│   │   │   └── unpdf.ts           # default PDF text extractor
│   │   ├── ocr/
│   │   │   └── tesseract.ts       # default OCR (tesseract.js, WASM)
│   │   └── fields/
│   │       ├── heuristic.ts       # regex/template field extractor
│   │       └── ollama.ts          # local LLM gap-filler (optional)
│   ├── extract/
│   │   └── index.ts               # pipeline orchestrator (uses registry)
│   └── ui/
│       ├── app.tsx                # Ink root + router
│       ├── login.tsx              # @clack/prompts pre-Ink for credential entry
│       ├── dashboard.tsx          # policy + OPD balance + recent claims
│       ├── claims-list.tsx
│       └── new-claim.tsx          # file pick → extract → review form → submit
```

## 9. Session Management

- Session cookies (`ASP.NET_SessionId`, auth tokens) are written to `.env` after login.
- `MEDIASSIST_COOKIE_EXPIRES_AT` is set conservatively (e.g., now + 20 min) — ASP.NET session sliding expiration is typically 20 min.
- Each call updates `MEDIASSIST_COOKIE_EXPIRES_AT` (sliding refresh).
- On any 401 / login-page-HTML response, the client throws `SessionExpiredError` → the UI catches and prompts re-login.

## 10. Build Phases

### Phase 1 — API layer + auth (no TUI) ✅ DONE
- `client.ts`, `auth.ts`, `user.ts`, `policy.ts`, `claims.ts`
- CLI commands: `bun run cli login | whoami | logout | policy | claims`
- **Acceptance:** ✅ login works, policy + OPD balance + beneficiaries shown, claims list shown with correct names/amounts/status.

### Phase 2 — Local document extraction (pluggable engines) ✅ DONE
- Pluggable engine architecture (see §5): `TextExtractor`, `OcrEngine`, `FieldExtractor` interfaces with a registry
- Default impls: `unpdf` (PDF), `tesseract.js` (OCR), `heuristic` (regex + per-vendor templates), `ollama` (optional LLM gap-fill)
- Orchestrator chains extractors and stops as soon as confidence is high enough
- CLI: `bun run cli extract <file>` prints fields + low-confidence list + engines path
- **Acceptance:** ✅ all 5 sample invoices (Arjun Optical ×3, Augmenta Health ×2) extract every field correctly with zero network calls. Pluggability verified — swap engines via `TEXT_EXTRACTOR` / `OCR_ENGINE` / `FIELD_EXTRACTORS` in `.env`.

### Phase 3 — Claim submission via API
- `lookups.ts` (pincode, hospitals, bill types)
- `claims.ts` add bill + upload + submit
- CLI command: `bun run cli submit <file>` (interactive review then submit)
- **Acceptance:** submits a real claim end-to-end and shows the claim reference.

### Phase 4 — TUI (Ink)
- Dashboard, Claims List, New Claim screens
- **Acceptance:** full flow runnable as `bun start`.

## 11. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| ASP.NET cookies don't survive in `.env` cleanly (special chars, length) | Store as base64 or in separate `~/.mediassist-tui/session.json` |
| Server returns HTML instead of JSON on session expiry, causing parse errors | Detect by content-type + first-byte check; treat as expired |
| Hospital search requires exact match from a curated list | Show top N suggestions in TUI; fallback to free-text where allowed |
| Pincode autocomplete may be needed for invoices missing pincode | Prompt user explicitly when missing |
| Claude PDF extraction occasionally wrong on edge cases (handwritten, low contrast) | Always show review screen with editable fields before submit |
| Captcha / MFA may be enforced server-side at some point | Out of scope for v1; document as future work |

## 12. Out of Scope (Future)
- Hospitalization claim flow
- Pre-authorization requests
- Family member dependent management
- Email/SMS notifications integration
- Docker / single-binary distribution
