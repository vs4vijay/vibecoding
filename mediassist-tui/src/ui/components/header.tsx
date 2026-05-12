import { Box, Text } from "ink";
import type { OpdBalance } from "../../api/policy.ts";
import type { Policy } from "../../types.ts";
import type { UserContext } from "../../api/user-context.ts";

export type ViewKey = "dashboard" | "claims" | "newClaim";

const TABS: { key: ViewKey; label: string; idx: number }[] = [
  { key: "dashboard", label: "Dashboard", idx: 1 },
  { key: "claims", label: "Claims", idx: 2 },
  { key: "newClaim", label: "New Claim", idx: 3 },
];

type HeaderProps = {
  user: UserContext;
  policy: Policy;
  balance: OpdBalance;
  activeView: ViewKey;
};

/**
 * Top status bar inspired by k9s: identity + key state on the left, view
 * tabs on the right. Always two lines tall — top line is context, bottom
 * is the tab strip — so it doesn't reshape as we navigate.
 */
export function Header({ user, policy, balance, activeView }: HeaderProps): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold color="cyan">Medi Assist  </Text>
        <Text>{user.fullName || "—"}</Text>
        <Text dimColor> ({user.empId})</Text>
        <Text dimColor> @ </Text>
        <Text>{user.entityCode}</Text>
        <Text dimColor>   ·   </Text>
        <Text dimColor>SI </Text>
        <Text color={pctColor(policy.available, policy.sumInsured)}>
          ₹ {fmt(policy.available)}
        </Text>
        <Text dimColor> / ₹ {fmt(policy.sumInsured)}</Text>
        <Text dimColor>   ·   </Text>
        <Text dimColor>OPD </Text>
        <Text color={pctColor(balance.familyBalance, balance.familyLimit)}>
          ₹ {fmt(balance.familyBalance)}
        </Text>
        <Text dimColor> / ₹ {fmt(balance.familyLimit)}</Text>
      </Box>
      <Box>
        {TABS.map((t, i) => (
          <Box key={t.key} marginRight={i < TABS.length - 1 ? 2 : 0}>
            <Text
              color={t.key === activeView ? "black" : "cyan"}
              backgroundColor={t.key === activeView ? "cyan" : undefined}
              bold={t.key === activeView}
            >
              {` ${t.idx} `}
            </Text>
            <Text> </Text>
            <Text color={t.key === activeView ? "white" : "gray"} bold={t.key === activeView}>
              {t.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function pctColor(remaining: number, total: number): "green" | "yellow" | "red" {
  if (total <= 0) return "green";
  const ratio = remaining / total;
  if (ratio < 0.1) return "red";
  if (ratio < 0.3) return "yellow";
  return "green";
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
