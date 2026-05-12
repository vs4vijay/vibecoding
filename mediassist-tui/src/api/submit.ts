/**
 * Builds the form-encoded payloads that the portal's web UI would POST during
 * an OPD claim submission. THESE FUNCTIONS DO NOT MAKE ANY HTTP REQUESTS —
 * they only assemble the body strings, for use by the dry-run TUI / CLI.
 *
 * Submission is intentionally NOT implemented; see
 * memory/feedback_mediassist_no_submit.md.
 */
import type { BankDetail } from "./bank.ts";
import type { ClaimFields } from "../types.ts";

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
