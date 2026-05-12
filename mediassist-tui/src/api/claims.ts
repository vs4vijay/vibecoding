import type { Claim, ClaimStatus } from "../types.ts";
import type { MediAssistClient } from "./client.ts";
import { getEntities } from "./user.ts";

const STATUS_KEYWORDS: Record<string, ClaimStatus> = {
  submitted: "Submitted",
  document: "Submitted",
  process: "Under Process",
  approved: "Approved",
  settled: "Settled",
  paid: "Settled",
  rejected: "Rejected",
  query: "Queried",
};

function normalizeStatus(raw: string | undefined): ClaimStatus {
  if (!raw) return "Unknown";
  const lower = raw.toLowerCase();
  for (const [kw, status] of Object.entries(STATUS_KEYWORDS)) {
    if (lower.includes(kw)) return status;
  }
  return "Unknown";
}

export type ListClaimsOptions = {
  /** Optional: defaults to all entities the user is associated with. */
  entityIds?: number[];
  fromDate?: string; // ISO
  toDate?: string; // ISO
};

/**
 * Lists the user's submitted claims via `/ServiceCalls/GetClaims.aspx`.
 *
 * The endpoint expects form-encoded body. `entityids` must be a JSON-stringified
 * array of the user's entity IDs (from `/Claims.aspx?LoadEntity=true`).
 */
export async function listClaims(
  client: MediAssistClient,
  opts: ListClaimsOptions = {},
): Promise<Claim[]> {
  const entityIds = opts.entityIds ?? (await getEntities(client)).map((e) => e.entityId);

  const form = new URLSearchParams();
  form.set("employeeCode", "");
  form.set("claimType", "");
  form.set("mobileNumber", "");
  form.set("fromDate", opts.fromDate ?? "");
  form.set("toDate", opts.toDate ?? "");
  form.set("entityids", JSON.stringify(entityIds));
  form.set("searchDateType", "");

  const res = await client.request("/ServiceCalls/GetClaims.aspx", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form.toString(),
  });

  const data = (await res.json()) as GetClaimsResponse;
  if (data.ErrorMessage) throw new Error(data.ErrorMessage);

  return (data.SearchResults ?? []).map(mapClaim);
}

function mapClaim(r: RawClaim): Claim {
  return {
    claimNumber: r.IWPClaimNumber || (r.CMSClaimId ? String(r.CMSClaimId) : "—"),
    beneficiary: r.BeneficiaryName ?? "—",
    billType: r.ClaimType,
    amount: r.ClaimedAmount ?? 0,
    approvedAmount: r.ApprovedAmount || undefined,
    submittedOn: formatIsoDate(r.ClaimSubmissionTime),
    status: normalizeStatus(r.ClaimStatus),
    raw: r,
  };
}

function formatIsoDate(iso?: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

// ---------- response shapes ----------

type GetClaimsResponse = {
  ErrorMessage: string | null;
  IsSuccess: boolean;
  SearchResults: RawClaim[];
};

type RawClaim = {
  ApprovedAmount?: number;
  BenefAge?: number;
  BeneficiaryName?: string;
  BenefRelation?: string;
  ClaimedAmount?: number;
  ClaimStatus?: string;
  ClaimSubmissionTime?: string;
  ClaimType?: string;
  CMSClaimId?: number;
  EmployeeCode?: string;
  EmployeeName?: string;
  IWPClaimNumber?: string;
  MediassistID?: number;
  PolicyId?: number;
  Ailment?: string;
};
