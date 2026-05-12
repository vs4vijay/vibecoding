import type { MediAssistClient } from "./client.ts";

export type BankDetail = {
  bankDetailsId: number;
  chequeLeafId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName: string;
  bankAddress: string;
  isPrimary: boolean;
  isActive: boolean;
};

/**
 * Returns the user's saved bank accounts. The `chequeLeafId` is the GUID
 * required by `SubmitClaim` to designate which account will receive the
 * reimbursement.
 */
export async function getBankDetails(client: MediAssistClient): Promise<BankDetail[]> {
  const res = await client.request("/ServiceCalls/GetUserBankDetails.aspx", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: "",
  });
  const list = (await res.json()) as RawBank[];
  return (list ?? []).map((b) => ({
    bankDetailsId: b.BankDetailsId,
    chequeLeafId: b.ChequeLeafID,
    accountHolderName: b.AccountHolderName,
    accountNumber: b.AccountNumber,
    ifscCode: b.BankIFSCCode,
    bankName: (b.BankName ?? "").trim(),
    branchName: b.BranchName,
    bankAddress: b.BankAddress,
    isPrimary: !!b.IsPrimary,
    isActive: !!b.IsActive,
  }));
}

type RawBank = {
  BankDetailsId: number;
  ChequeLeafID: string;
  AccountHolderName: string;
  AccountNumber: string;
  BankIFSCCode: string;
  BankName?: string;
  BranchName: string;
  BankAddress: string;
  IsPrimary?: boolean;
  IsActive?: boolean;
};
