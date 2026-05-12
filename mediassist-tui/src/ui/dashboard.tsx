import { Box, Text } from "ink";
import type { Claim, Policy } from "../types.ts";
import type { OpdBalance } from "../api/policy.ts";

type DashboardProps = {
  policy: Policy;
  balance: OpdBalance;
  claims: Claim[];
};

/**
 * Read-only summary view, k9s-dashboard style. Most identity/balance info
 * lives in the header now; this view focuses on benefits + recent activity.
 */
export function Dashboard({ policy, balance, claims }: DashboardProps): JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <BalancePanel policy={policy} balance={balance} />
      <Box marginTop={1} flexDirection="row" gap={1}>
        <Box flexBasis="40%">
          <BeneficiariesPanel policy={policy} />
        </Box>
        <Box flexBasis="60%">
          <RecentClaimsPanel claims={claims} />
        </Box>
      </Box>
    </Box>
  );
}

function BalancePanel({ policy, balance }: { policy: Policy; balance: OpdBalance }): JSX.Element {
  return (
    <Box flexDirection="row" gap={1}>
      <Bar
        label="Sum Insured (family)"
        total={policy.sumInsured}
        used={policy.sumInsured - policy.available}
        remaining={policy.available}
      />
      <Bar
        label="OPD (family)"
        total={balance.familyLimit}
        used={balance.familyLimit - balance.familyBalance}
        remaining={balance.familyBalance}
      />
    </Box>
  );
}

function Bar({ label, total, used, remaining }: { label: string; total: number; used: number; remaining: number }): JSX.Element {
  const width = 30;
  const ratio = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const color = ratio > 0.9 ? "red" : ratio > 0.7 ? "yellow" : "green";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexGrow={1}>
      <Text bold>{label}</Text>
      <Text color={color}>{bar}</Text>
      <Box>
        <Text dimColor>total </Text>
        <Text>₹ {fmt(total)}</Text>
        <Text dimColor>  ·  used </Text>
        <Text>₹ {fmt(used)}</Text>
        <Text dimColor>  ·  left </Text>
        <Text color={color}>₹ {fmt(remaining)}</Text>
      </Box>
    </Box>
  );
}

function BeneficiariesPanel({ policy }: { policy: Policy }): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Beneficiaries ({policy.beneficiaries.length})</Text>
      {policy.beneficiaries.map((b) => (
        <Box key={b.id}>
          <Text>{b.name.padEnd(28)}</Text>
          <Text dimColor>{b.relation.padEnd(10)}</Text>
          <Text dimColor>{b.dob ?? ""}</Text>
        </Box>
      ))}
    </Box>
  );
}

function RecentClaimsPanel({ claims }: { claims: Claim[] }): JSX.Element {
  const recent = claims.slice(0, 8);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>
        Recent claims <Text dimColor>(showing {recent.length} of {claims.length})</Text>
      </Text>
      {recent.length === 0 ? (
        <Text dimColor>No claims yet.</Text>
      ) : (
        <>
          <Box>
            <Text dimColor>{"Date".padEnd(13)}{"Beneficiary".padEnd(22)}{"Amount".padStart(10)}   Status</Text>
          </Box>
          {recent.map((c) => (
            <Box key={c.claimNumber}>
              <Text>{c.submittedOn.padEnd(13)}</Text>
              <Text>{c.beneficiary.padEnd(22)}</Text>
              <Text color="cyan">{`₹ ${fmt(c.amount)}`.padStart(10)}</Text>
              <Text>   </Text>
              <Text color={statusColor(c.status)}>{c.status}</Text>
            </Box>
          ))}
          <Text dimColor>(press [2] to see all)</Text>
        </>
      )}
    </Box>
  );
}

function statusColor(s: string): "green" | "yellow" | "red" | "white" {
  switch (s) {
    case "Settled":
    case "Approved":
      return "green";
    case "Under Process":
    case "Submitted":
      return "yellow";
    case "Rejected":
    case "Queried":
      return "red";
    default:
      return "white";
  }
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
