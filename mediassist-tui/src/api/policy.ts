import type { Beneficiary, Policy } from "../types.ts";
import type { MediAssistClient } from "./client.ts";

/**
 * Fetches policy + beneficiaries for the logged-in user.
 *
 * `POST /ServiceCalls/GetPolicies.aspx` accepts an empty form body and uses
 * the session to identify the user. Returns `{ Policies: [...] }` where each
 * Policy carries a `Beneficiaries[]` list with the actual sum-insured / OPD
 * balance fields (prefixed `CMS*`).
 */
export async function getPolicy(client: MediAssistClient): Promise<Policy> {
  const res = await client.request("/ServiceCalls/GetPolicies.aspx", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: "",
  });
  const data = (await res.json()) as PoliciesResponse;
  const policy = data.Policies?.[0];
  if (!policy) throw new Error("No active policy found");

  const self = (policy.Beneficiaries ?? []).find((b) => b.CMSMemberRelation === "Self");
  const anyBenef = policy.Beneficiaries?.[0];
  const seed = self ?? anyBenef;

  return {
    policyNumber: policy.PolicyNumber ?? seed?.PolicyNumber ?? "—",
    policyHolder: seed?.PolHolderName ?? seed?.CMSEmployeeName ?? "—",
    sumInsured: seed?.CMSFamilySumInsured ?? 0,
    available: seed?.CMSFamilyBalanceSumInsured ?? 0,
    insurer: policy.InsuranceCompany ?? seed?.InsuranceCompany ?? "—",
    validTill: policy.PolEndDateStr ?? formatIsoDate(policy.PolicyEndDate),
    beneficiaries: (policy.Beneficiaries ?? []).map(mapBeneficiary),
  };
}

/**
 * Returns OPD (domiciliary) limits and remaining balance for the self member.
 */
export type OpdBalance = {
  familyLimit: number;
  familyBalance: number;
  selfLimit: number;
  selfBalance: number;
};

export async function getOpdBalance(client: MediAssistClient): Promise<OpdBalance> {
  const res = await client.request("/ServiceCalls/GetPolicies.aspx", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: "",
  });
  const data = (await res.json()) as PoliciesResponse;
  const policy = data.Policies?.[0];
  const self = (policy?.Beneficiaries ?? []).find((b) => b.CMSMemberRelation === "Self");
  return {
    familyLimit: self?.CMSFamilyDomiLimit ?? 0,
    familyBalance: self?.CMSFamilyDomiBalance ?? 0,
    selfLimit: self?.CMSMemberDomiLimit ?? 0,
    selfBalance: self?.CMSMemberDomiBalance ?? 0,
  };
}

function mapBeneficiary(b: RawBeneficiary): Beneficiary {
  return {
    id: String(b.CMSPriBenefId ?? b.CMSMemberMAID ?? b.CMSMemberName ?? ""),
    name: b.CMSMemberName ?? "—",
    relation: b.CMSMemberRelation ?? "—",
    dob: formatIsoDate(b.CMSMemberDOB),
  };
}

function formatIsoDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

// ---------- response shapes (only the fields we use) ----------

type PoliciesResponse = {
  Policies: Array<{
    PolicyNumber?: string;
    PolicyEndDate?: string;
    PolEndDateStr?: string;
    InsuranceCompany?: string;
    Beneficiaries?: RawBeneficiary[];
  }>;
};

type RawBeneficiary = {
  CMSEmployeeName?: string;
  CMSEmployeeCode?: string;
  CMSPriBenefId?: number;
  CMSMemberMAID?: number;
  CMSMemberName?: string;
  CMSMemberRelation?: string;
  CMSMemberDOB?: string;
  CMSMemberAge?: number;
  CMSMemberDomiLimit?: number;
  CMSMemberDomiBalance?: number;
  CMSFamilySumInsured?: number;
  CMSFamilyBalanceSumInsured?: number;
  CMSFamilyDomiLimit?: number;
  CMSFamilyDomiBalance?: number;
  PolicyNumber?: string;
  PolHolderName?: string;
  InsuranceCompany?: string;
};
