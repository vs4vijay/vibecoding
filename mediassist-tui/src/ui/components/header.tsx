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
 * Top status bar. Two compact lines:
 *   line 1 — identity + balance summary (single Text, see Trap 5: sibling
 *            Text whitespace collapse), kept tight so it fits in narrow
 *            terminals (~80 chars).
 *   line 2 — numbered view tabs.
 */
export function Header({ user, policy, balance, activeView }: HeaderProps): JSX.Element {
  const id = user.fullName || "—";
  const entity = user.entityCode || "—";
  const siColor = pctColor(policy.available, policy.sumInsured);
  const opdColor = pctColor(balance.familyBalance, balance.familyLimit);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text>
        <Text bold color="cyan">Medi Assist</Text>
        <Text dimColor>  ·  </Text>
        <Text>{id}</Text>
        <Text dimColor>  @ </Text>
        <Text>{entity}</Text>
        <Text dimColor>  ·  SI </Text>
        <Text color={siColor}>₹ {fmt(policy.available)}</Text>
        <Text dimColor>  ·  OPD </Text>
        <Text color={opdColor}>₹ {fmt(balance.familyBalance)}</Text>
      </Text>
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
