import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { Claim, Policy } from "../types.ts";
import type { OpdBalance } from "../api/policy.ts";

type DashboardProps = {
  policy: Policy;
  balance: OpdBalance;
  claims: Claim[];
};

/**
 * Read-only summary view, k9s-dashboard style. All rows use the same
 * `flexBasis={0} flexGrow={1}` pattern so the panels align to identical
 * widths across the rows — no ragged right edge.
 */
export function Dashboard({ policy, balance, claims }: DashboardProps): JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Row>
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
      </Row>
      <Box marginTop={1} />
      <Row>
        <BeneficiariesPanel policy={policy} />
        <RecentClaimsPanel claims={claims} />
      </Row>
    </Box>
  );
}

/**
 * Two-column row layout — each child gets equal flex share so the row width
 * matches the row above it.
 */
function Row({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Box flexDirection="row" gap={1}>
      {Array.isArray(children)
        ? children.map((c, i) => (
            <Box key={i} flexBasis={0} flexGrow={1}>
              {c}
            </Box>
          ))
        : children}
    </Box>
  );
}

function Bar({
  label,
  total,
  used,
  remaining,
}: {
  label: string;
  total: number;
  used: number;
  remaining: number;
}): JSX.Element {
  const width = 28;
  const ratio = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const color = ratio > 0.9 ? "red" : ratio > 0.7 ? "yellow" : "green";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>{label}</Text>
      <Text color={color}>{bar}</Text>
      <Text>
        <Text dimColor>total </Text>
        ₹ {fmt(total)}
        <Text dimColor>  ·  used </Text>
        ₹ {fmt(used)}
        <Text dimColor>  ·  left </Text>
        <Text color={color}>₹ {fmt(remaining)}</Text>
      </Text>
    </Box>
  );
}

function BeneficiariesPanel({ policy }: { policy: Policy }): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Beneficiaries ({policy.beneficiaries.length})</Text>
      {policy.beneficiaries.map((b) => (
        // Single Text per row → Ink can't split it onto multiple visual lines
        // (no blank-row artifacts) and the spaces from padEnd are preserved.
        <Text key={b.id}>
          {b.name.slice(0, 22).padEnd(22)}{"  "}
          <Text dimColor>{b.relation.slice(0, 10).padEnd(10)}{"  "}{b.dob ?? ""}</Text>
        </Text>
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
          <Text dimColor>
            {"Date".padEnd(13)}{"Beneficiary".padEnd(22)}{"Amount".padStart(10)}   Status
          </Text>
          {recent.map((c) => (
            <Text key={c.claimNumber}>
              {c.submittedOn.padEnd(13)}
              {c.beneficiary.slice(0, 20).padEnd(22)}
              <Text color="cyan">{`₹ ${fmt(c.amount)}`.padStart(10)}</Text>
              {"   "}
              <Text color={statusColor(c.status)}>{c.status}</Text>
            </Text>
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
