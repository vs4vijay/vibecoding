import type { BillType } from "../types.ts";
import type { MediAssistClient } from "./client.ts";

export type BillTypeEntry = { id: number; name: string };
export type PincodeLocality = {
  pincode: number;
  locationName: string;
  cityId: number;
  cityName: string;
  stateId: number;
  stateName: string;
};

/**
 * Returns the list of available bill types for a given FlexBen policy.
 *
 * The endpoint expects an ASMX-style payload `{ FlexBenPolicyId: <number> }`
 * and returns `{ d: [{ BillTypeId, BillCategoryName }, ...] }`.
 */
export async function getBillTypes(
  client: MediAssistClient,
  policyId: number,
): Promise<BillTypeEntry[]> {
  const raw = await client.postJson<RawBillType[]>(
    "/OPDClaimSubmission.aspx/GetbillTypeList",
    { FlexBenPolicyId: policyId },
  );
  return (raw ?? []).map((r) => ({ id: r.BillTypeId, name: r.BillCategoryName }));
}

/**
 * Resolves a 6-digit pincode to one or more localities (with City/State IDs).
 * Returns an empty list if the pincode isn't recognized.
 */
export async function lookupPincode(
  client: MediAssistClient,
  pincode: string,
): Promise<PincodeLocality[]> {
  const n = Number(pincode);
  if (!Number.isFinite(n) || pincode.length !== 6) return [];
  const raw = await client.postJson<RawPincodeData>(
    "/NewClaimSubmission_New.aspx/GetPincodeData",
    { pinCode: n },
  );
  if (!raw?.isSuccess || !raw.PinCodes) return [];
  return raw.PinCodes.map((p) => ({
    pincode: p.PinCode,
    locationName: (p.LocationName ?? "").trim(),
    cityId: p.CityID,
    cityName: p.CityName,
    stateId: p.StateID,
    stateName: p.StateName,
  }));
}

/**
 * Resolves a `BillType` (UI label) to its server-side `BillTypeId`.
 * Some labels differ slightly between portal copies — the matcher is case-
 * and whitespace-insensitive, with a few aliases.
 */
export function matchBillType(types: BillTypeEntry[], wanted: BillType): BillTypeEntry | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const target = norm(wanted);
  for (const t of types) {
    if (norm(t.name) === target) return t;
  }
  return null;
}

// ---------- raw response shapes ----------

type RawBillType = {
  __type?: string;
  BillTypeId: number;
  BillCategoryName: string;
};

type RawPincodeData = {
  isSuccess?: boolean;
  errorMsg?: string;
  PinCodes?: Array<{
    PinCode: number;
    LocationName?: string;
    CityID: number;
    CityName: string;
    DistrictID?: number;
    DistrictName?: string;
    StateID: number;
    StateName: string;
  }>;
  NoResultMessage?: string | null;
};
