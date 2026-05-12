import type { MediAssistClient } from "./client.ts";

export type UserContext = {
  empId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  mobile: string;
  alternateMobile: string;
  entityId: number;
  entityCode: string;
  entityName: string;
  corporateId: number;
  roleName: string;
  isHr: boolean;
};

/**
 * Returns the logged-in user's identity.
 *
 * The portal embeds the full user profile server-side as a
 * `var commonauthobj = {...}` JSON literal on most authenticated content
 * pages (Policy, Claims, etc.). The top-level Home / index pages do NOT
 * include it. We scrape it from Policy.aspx, which is reliably available
 * to every employee.
 */
export async function getUserContext(client: MediAssistClient): Promise<UserContext> {
  const html = await client.getText("/Policy.aspx");
  const match = /var\s+commonauthobj\s*=\s*({[\s\S]*?});/.exec(html);
  if (!match?.[1]) {
    throw new Error("Could not locate `commonauthobj` on /Policy.aspx (session may have expired)");
  }
  let parsed: RawCommonAuth;
  try {
    parsed = JSON.parse(match[1]) as RawCommonAuth;
  } catch (err) {
    throw new Error(`Failed to parse commonauthobj JSON: ${(err as Error).message}`);
  }
  const u = parsed.userDetailsVO ?? ({} as RawCommonAuth["userDetailsVO"]);
  const first = u.FirstName?.trim() ?? "";
  const last = u.LastName?.trim() ?? "";
  return {
    empId: u.EmployeeId ?? "",
    firstName: first,
    lastName: last,
    fullName: [first, last].filter(Boolean).join(" "),
    email: u.EmailID ?? "",
    mobile: u.Mobile ?? "",
    alternateMobile: u.AlternateMobile ?? "",
    entityId: u.EntityId ?? 0,
    entityCode: u.EntityCode ?? "",
    entityName: u.EntityName ?? "",
    corporateId: u.CorporateId ?? 0,
    roleName: u.RoleName ?? "",
    isHr: (u.RoleName ?? "").toLowerCase() === "globalhr",
  };
}

type RawCommonAuth = {
  userDetailsVO: {
    UserName?: string;
    Mobile?: string;
    AlternateMobile?: string;
    EmailID?: string;
    EmployeeId?: string;
    FirstName?: string;
    LastName?: string;
    EntityId?: number;
    EntityCode?: string;
    EntityName?: string;
    CorporateId?: number;
    RoleName?: string;
  };
};
