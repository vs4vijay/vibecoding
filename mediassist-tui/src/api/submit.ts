/**
 * Builds the form-encoded payloads that the portal's web UI would POST during
 * an OPD claim submission. THESE FUNCTIONS DO NOT MAKE ANY HTTP REQUESTS —
 * they only assemble the body strings, for use by the dry-run CLI.
 *
 * Submission is intentionally NOT implemented; see
 * memory/feedback_mediassist_no_submit.md.
 */
import type { BankDetail } from "./bank.ts";
import type { ClaimFields } from "../types.ts";

export type Beneficiary = {
  /** CMSPriBenefId */
  id: number;
  /** CMSMemberMAID */
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
  /** Bill-type ID for the chosen BillType. */
  billTypeId: number;
  /** Hospital/clinic name as the user wants it on the claim. */
  hospitalName: string;
  /** Document count uploaded so far (informational). */
  totalDocCount: number;
};

export type Payloads = {
  saveDraft: Record<string, string>;
  addClaimBill: Record<string, string>;
  submitClaim: Record<string, string>;
  /** Multipart upload — only the field names + the file path, not the wire body. */
  fileUpload: { endpoint: string; field: string; filePath: string };
};

/**
 * Builds the SaveDraft body. The portal calls this first to mint a
 * `ClaimRegNo` that ties together the bills and the document uploads.
 */
export function buildSaveDraftBody(
  fields: ClaimFields,
  ctx: SubmitContext,
): Record<string, string> {
  const b = ctx.beneficiary;
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
    TreatmentStartDate: toMMDDYYYY(fields.billDate),
    TreatmentEndDate: toMMDDYYYY(fields.billDate),
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
    TotalBillAmount: String(fields.billAmount),
    InjuryDesc: "",
    Ailment: fields.natureOfIllness,
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
 * Builds one AddClaimBill body — invoked once per invoice when there are
 * multiple bills on a single claim.
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
    billDate: toMMDDYYYY(fields.billDate),
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
  fields: ClaimFields,
  ctx: SubmitContext,
  claimRegNo: string,
): Record<string, string> {
  return {
    ClmRegNo: claimRegNo,
    empid: ctx.empId,
    email: ctx.email,
    Entity: String(ctx.entityId),
    mobileno: ctx.mobile,
    chequeleafId: ctx.bank.chequeLeafId,
    ReasonForlateClaim: "",
    TotalBillAmount: String(fields.billAmount),
  };
}

/**
 * Builds the full chain of payloads for a single-bill claim. `claimRegNo`
 * is a placeholder string the dry-run uses; the real value is minted by
 * `SaveDraft` server-side.
 */
export function buildPayloadsForDryRun(
  fields: ClaimFields,
  ctx: SubmitContext,
  filePath: string,
  claimRegNoPlaceholder = "<server-generated-after-SaveDraft>",
): Payloads {
  return {
    saveDraft: buildSaveDraftBody(fields, ctx),
    addClaimBill: buildAddClaimBillBody(fields, ctx, claimRegNoPlaceholder),
    submitClaim: buildSubmitClaimBody(fields, ctx, claimRegNoPlaceholder),
    fileUpload: {
      endpoint: "/fileuploaddomi2.aspx",
      field: "Filedata",
      filePath,
    },
  };
}

function toMMDDYYYY(ddmmyyyy: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ddmmyyyy);
  return m ? `${m[2]}-${m[1]}-${m[3]}` : ddmmyyyy;
}
