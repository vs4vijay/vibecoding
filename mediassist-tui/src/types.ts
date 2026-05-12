export const BILL_TYPES = [
  "Vision & Dental",
  "Vaccination",
  "Pharmacy & Medicines",
  "OPD-Consultation",
  "Investigation & Labs",
  "Investigation & Lab Charges",
  "Health Check Up",
] as const;

export type BillType = (typeof BILL_TYPES)[number];

export type ClaimFields = {
  billType: BillType;
  billAmount: number;
  billNumber: string;
  /** DD-MM-YYYY */
  billDate: string;
  clinicName: string;
  pincode?: string;
  natureOfIllness: string;
  beneficiaryHint?: string;
  rawText: string;
  /** Per-field confidence in [0, 1]. Missing keys mean "no signal". */
  confidence?: Partial<Record<keyof ClaimFields, number>>;
};

export type Beneficiary = {
  id: string;
  name: string;
  relation: string;
  dob?: string;
};

export type Policy = {
  policyNumber: string;
  policyHolder: string;
  sumInsured: number;
  available: number;
  insurer: string;
  validTill?: string;
  beneficiaries: Beneficiary[];
};

export type ClaimStatus =
  | "Submitted"
  | "Under Process"
  | "Approved"
  | "Settled"
  | "Rejected"
  | "Queried"
  | "Unknown";

export type Claim = {
  claimNumber: string;
  beneficiary: string;
  billType?: string;
  amount: number;
  approvedAmount?: number;
  submittedOn: string;
  status: ClaimStatus;
  raw?: unknown;
};
