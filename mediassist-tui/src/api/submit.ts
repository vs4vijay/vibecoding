/**
 * Builds the form-encoded payloads for an OPD claim submission AND, when
 * called via `submitClaimChain`, actually executes the four-step submit:
 *   1. SaveDraft         → mints ClaimRegNo
 *   2. uploadDocument()  × N (per file)
 *   3. AddClaimBill      × N (per bill)
 *   4. SubmitClaim
 *
 * The payload builders are exported separately so callers (dry-run UI) can
 * inspect what would be sent before confirming. Callers must observe the
 * safety rules in memory/feedback_mediassist_no_submit.md — typed
 * confirmation, no silent submission, step-by-step progress.
 */
import type { MediAssistClient } from "./client.ts";
import type { BankDetail } from "./bank.ts";
import type { ClaimFields } from "../types.ts";
import { uploadDocument } from "./upload.ts";

export type Beneficiary = {
  /** CMSMemberUserId — the value the portal expects in `benefId`. */
  id: number;
  /** CMSMemberMAID — the master Medi Assist identifier for this person. */
  maid: number;
  name: string;
  relation: string;
  relationId: number;
  age: number;
  alphaCode?: string;
  employeeCode: string;
  policyId: number;
  policyNumber: string;
  insurer: string;
};

export type SubmitContext = {
  beneficiary: Beneficiary;
  bank: BankDetail;
  empId: string;
  entityId: number;
  email: string;
  mobile: string;
  /** Resolved pincode → city/state. */
  cityId: number;
  cityName: string;
  stateId: number;
  stateName: string;
  pincode: string;
  locality: string;
  /** Bill-type ID for the chosen BillType (per bill). */
  billTypeId: number;
  /** Hospital/clinic name as the user wants it on the claim. */
  hospitalName: string;
  /** Number of supporting documents uploaded. */
  totalDocCount: number;
};

export type FileUploadPlan = {
  endpoint: string;
  field: string;
  filePath: string;
};

export type Payloads = {
  saveDraft: Record<string, string>;
  /** One per bill — the order matches the input bills array. */
  addClaimBills: Record<string, string>[];
  submitClaim: Record<string, string>;
  /** One per file to upload. */
  fileUploads: FileUploadPlan[];
};

/**
 * Builds the full chain of payloads for a single-beneficiary claim with one
 * or more bills attached. `claimRegNoPlaceholder` stands in for the real
 * value (minted server-side by SaveDraft) — useful for the dry-run printer.
 */
export function buildPayloadsForDryRun(
  bills: ClaimFields[],
  ctx: SubmitContext,
  filePaths: string[],
  claimRegNoPlaceholder = "<server-generated-after-SaveDraft>",
): Payloads {
  if (bills.length === 0) {
    throw new Error("buildPayloadsForDryRun: at least one bill is required");
  }
  const total = bills.reduce((s, b) => s + b.billAmount, 0);
  const dates = bills.map((b) => parseDDMMYYYY(b.billDate)).filter((d): d is Date => d !== null);
  const startDate = dates.length > 0 ? toMMDDYYYY(dates.reduce((a, b) => (a < b ? a : b))) : "";
  const endDate = dates.length > 0 ? toMMDDYYYY(dates.reduce((a, b) => (a > b ? a : b))) : "";
  const firstBill = bills[0]!;

  return {
    saveDraft: buildSaveDraftBody(firstBill, bills, ctx, total, startDate, endDate),
    addClaimBills: bills.map((b) => buildAddClaimBillBody(b, ctx, claimRegNoPlaceholder)),
    submitClaim: buildSubmitClaimBody(ctx, claimRegNoPlaceholder, total),
    fileUploads: filePaths.map((p) => ({
      endpoint: "/fileuploaddomi2.aspx",
      field: "Filedata",
      filePath: p,
    })),
  };
}

/**
 * Builds the SaveDraft body. The portal calls this first to mint a
 * `ClaimRegNo` that ties together the bills and the document uploads.
 */
export function buildSaveDraftBody(
  firstBill: ClaimFields,
  allBills: ClaimFields[],
  ctx: SubmitContext,
  totalAmount: number,
  startDate: string,
  endDate: string,
): Record<string, string> {
  const b = ctx.beneficiary;
  const ailment = [...new Set(allBills.map((x) => x.natureOfIllness).filter(Boolean))].join(" || ");
  return {
    claimRegnNo: "", // empty → server generates a new one
    accountNum: ctx.bank.accountNumber,
    accountHolderName: ctx.bank.accountHolderName,
    ifscCode: ctx.bank.ifscCode,
    bankName: encodeURIComponent(ctx.bank.bankName),
    branch: encodeURIComponent(ctx.bank.branchName),
    branchAddress: encodeURIComponent(ctx.bank.bankAddress),
    policyId: String(b.policyId),
    policyNumber: b.policyNumber,
    maid: String(b.maid),
    insurer: b.insurer,
    TreatmentStartDate: startDate || toMMDDYYYY(parseDDMMYYYY(firstBill.billDate) ?? new Date()),
    TreatmentEndDate: endDate || toMMDDYYYY(parseDDMMYYYY(firstBill.billDate) ?? new Date()),
    DOA: "",
    DOD: "",
    hospId: "0",
    hospitalName: ctx.hospitalName,
    hospCityId: String(ctx.cityId),
    hospCityName: ctx.cityName,
    hospStateId: String(ctx.stateId),
    hospStateName: ctx.stateName,
    HospAddress: ctx.pincode,
    benefId: String(b.id),
    benefName: b.name,
    benefRelation: String(b.relationId),
    relationName: b.relation,
    benefAge: String(b.age),
    benefMobileNo: ctx.mobile,
    TotalBillAmount: String(totalAmount),
    InjuryDesc: "",
    Ailment: ailment,
    durationOfIllness: "",
    checklist: "",
    claimType: "Domi", // portal labels OPD claims as "Domi" internally
    BenefAlphaCode: b.alphaCode ?? "",
    DoctorName: ctx.hospitalName,
    DoctorRegNo: "",
    BenefEmail: ctx.email,
    EmployeeId: ctx.empId,
    TotalDocCount: String(ctx.totalDocCount),
    BenefitCategory: "FlexBenPolicyId",
    Checklist: "",
  };
}

/**
 * Builds one AddClaimBill body — invoked once per invoice. Each bill carries
 * its own bill-type ID (callers must set `ctx.billTypeId` per call if bills
 * have different types) — usually bills in a single claim share a type.
 */
export function buildAddClaimBillBody(
  fields: ClaimFields,
  ctx: SubmitContext,
  claimRegNo: string,
): Record<string, string> {
  return {
    clmRegNo: claimRegNo,
    billNum: fields.billNumber,
    billAmnt: String(fields.billAmount),
    billDate: toMMDDYYYY(parseDDMMYYYY(fields.billDate) ?? new Date()),
    billId: String(ctx.billTypeId),
    billDesc: fields.billType,
    VendorName: ctx.hospitalName,
    DoctorRegNo: "",
    PrescriptionDate: "",
    Address: `${ctx.hospitalName},${ctx.locality},${ctx.pincode}`,
    City: ctx.cityName,
    State: ctx.stateName,
    Pincode: ctx.pincode,
  };
}

/**
 * Builds the final SubmitClaim body.
 */
export function buildSubmitClaimBody(
  ctx: SubmitContext,
  claimRegNo: string,
  totalAmount: number,
): Record<string, string> {
  return {
    ClmRegNo: claimRegNo,
    empid: ctx.empId,
    email: ctx.email,
    Entity: String(ctx.entityId),
    mobileno: ctx.mobile,
    chequeleafId: ctx.bank.chequeLeafId,
    ReasonForlateClaim: "",
    TotalBillAmount: String(totalAmount),
  };
}

// ===========================================================================
//  EXECUTION — the chain that actually submits the claim
// ===========================================================================

export type SubmitProgress =
  | { step: "saveDraft"; status: "in-progress" }
  | { step: "saveDraft"; status: "ok"; claimRegNo: string }
  | { step: "upload"; status: "in-progress"; index: number; total: number; filename: string }
  | { step: "upload"; status: "ok"; index: number; total: number; filename: string }
  | { step: "addBill"; status: "in-progress"; index: number; total: number }
  | { step: "addBill"; status: "ok"; index: number; total: number }
  | { step: "submit"; status: "in-progress" }
  | { step: "submit"; status: "ok"; claimRegNo: string };

export type SubmitResult = {
  claimRegNo: string;
};

/**
 * Executes the full submission chain. Calls `onProgress` after each milestone
 * so the UI can render a step-by-step progress list. Throws on the first
 * failure with a message that includes which step failed.
 */
export async function submitClaimChain(
  client: MediAssistClient,
  bills: ClaimFields[],
  ctx: SubmitContext,
  filePaths: string[],
  onProgress: (event: SubmitProgress) => void,
): Promise<SubmitResult> {
  if (bills.length === 0) throw new Error("Cannot submit a claim with zero bills");
  if (filePaths.length === 0) {
    throw new Error("Cannot submit a claim with zero documents (portal rejects with 'DocNotUploaded')");
  }

  const total = bills.reduce((s, b) => s + b.billAmount, 0);
  const dates = bills.map((b) => parseDDMMYYYY(b.billDate)).filter((d): d is Date => d !== null);
  const startDate = dates.length > 0 ? toMMDDYYYY(dates.reduce((a, b) => (a < b ? a : b))) : "";
  const endDate = dates.length > 0 ? toMMDDYYYY(dates.reduce((a, b) => (a > b ? a : b))) : "";
  const firstBill = bills[0]!;

  // --- Step 1: SaveDraft ---
  onProgress({ step: "saveDraft", status: "in-progress" });
  const saveDraftBody = buildSaveDraftBody(firstBill, bills, ctx, total, startDate, endDate);
  const draftJson = await postForm<SaveDraftResponse>(client, "/ServiceCalls/SaveDraft.aspx", saveDraftBody);
  if (!draftJson.IsSuccess || !draftJson.ClaimRegNo) {
    throw new Error(
      `SaveDraft failed: ${draftJson.ErrorMessage || "no ClaimRegNo returned"}`,
    );
  }
  const claimRegNo = draftJson.ClaimRegNo;
  onProgress({ step: "saveDraft", status: "ok", claimRegNo });

  // --- Step 2: uploads ---
  for (let i = 0; i < filePaths.length; i++) {
    const filename = basenameOf(filePaths[i]!);
    onProgress({ step: "upload", status: "in-progress", index: i + 1, total: filePaths.length, filename });
    await uploadDocument(client, filePaths[i]!);
    onProgress({ step: "upload", status: "ok", index: i + 1, total: filePaths.length, filename });
  }

  // --- Step 3: AddClaimBill (one per bill) ---
  for (let i = 0; i < bills.length; i++) {
    onProgress({ step: "addBill", status: "in-progress", index: i + 1, total: bills.length });
    const billBody = buildAddClaimBillBody(bills[i]!, ctx, claimRegNo);
    const billJson = await postForm<AddBillResponse>(client, "/ServiceCalls/AddClaimBill.aspx", billBody);
    if (!billJson.IsSuccess) {
      throw new Error(
        `AddClaimBill #${i + 1} failed: ${billJson.ErrorMessage || "no error message"} (ClaimRegNo ${claimRegNo} created — cancel via web UI if needed)`,
      );
    }
    onProgress({ step: "addBill", status: "ok", index: i + 1, total: bills.length });
  }

  // --- Step 4: SubmitClaim ---
  onProgress({ step: "submit", status: "in-progress" });
  const submitBody = buildSubmitClaimBody(ctx, claimRegNo, total);
  const submitText = await postFormRaw(client, "/ServiceCalls/SubmitClaim.aspx", submitBody);
  if (/^["']?DocNotUploaded["']?$/i.test(submitText.trim())) {
    throw new Error(
      `SubmitClaim refused: server says no document was uploaded. ClaimRegNo ${claimRegNo} exists as draft — cancel via web UI.`,
    );
  }
  onProgress({ step: "submit", status: "ok", claimRegNo });
  return { claimRegNo };
}

type SaveDraftResponse = { IsSuccess?: boolean; ClaimRegNo?: string; ErrorMessage?: string };
type AddBillResponse = { IsSuccess?: boolean; ErrorMessage?: string };

async function postForm<T>(
  client: MediAssistClient,
  path: string,
  body: Record<string, string>,
): Promise<T> {
  const text = await postFormRaw(client, path, body);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }
}

async function postFormRaw(
  client: MediAssistClient,
  path: string,
  body: Record<string, string>,
): Promise<string> {
  const form = new URLSearchParams(body);
  const res = await client.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

// ===========================================================================
//  Helpers (date conversion)
// ===========================================================================

function parseDDMMYYYY(ddmmyyyy: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ddmmyyyy);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

function toMMDDYYYY(input: string | Date): string {
  if (input instanceof Date) {
    const m = String(input.getMonth() + 1).padStart(2, "0");
    const d = String(input.getDate()).padStart(2, "0");
    const y = String(input.getFullYear());
    return `${m}-${d}-${y}`;
  }
  // assume already DD-MM-YYYY
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(input);
  return m ? `${m[2]}-${m[1]}-${m[3]}` : input;
}
