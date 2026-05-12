import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { MediAssistClient } from "../api/client.ts";
import { getOpdBalance, getPolicy, type OpdBalance } from "../api/policy.ts";
import { listClaims } from "../api/claims.ts";
import { getUserContext, type UserContext } from "../api/user-context.ts";
import type { Claim, Policy } from "../types.ts";

type DashboardProps = {
  client: MediAssistClient;
  /** Bumped by the app shell when the user hits `r`. */
  refreshKey: number;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      user: UserContext;
      policy: Policy;
      balance: OpdBalance;
      claims: Claim[];
    };

export function Dashboard({ client, refreshKey }: DashboardProps): JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      try {
        const [user, policy, balance, claims] = await Promise.all([
          getUserContext(client),
          getPolicy(client),
          getOpdBalance(client),
          listClaims(client),
        ]);
        if (!cancelled) setState({ kind: "ready", user, policy, balance, claims });
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, refreshKey]);

  if (state.kind === "loading") return <Text color="cyan">Loading dashboard…</Text>;
  if (state.kind === "error") return <Text color="red">Error: {state.message}</Text>;

  const { user, policy, balance, claims } = state;
  return (
    <Box flexDirection="column">
      <Header user={user} policy={policy} />
      <Box marginTop={1}>
        <BalancePanel policy={policy} balance={balance} />
      </Box>
      <Box marginTop={1} flexDirection="row">
        <Box flexGrow={1}>
          <BeneficiariesPanel policy={policy} />
        </Box>
      </Box>
      <Box marginTop={1}>
        <RecentClaimsSummary claims={claims} />
      </Box>
    </Box>
  );
}

function Header({ user, policy }: { user: UserContext; policy: Policy }): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text bold color="cyan">Medi Assist</Text>
        <Text dimColor> · </Text>
        <Text bold>{user.fullName || "—"}</Text>
        <Text dimColor> ({user.empId})</Text>
        <Text dimColor> @ </Text>
        <Text>{user.entityCode}</Text>
      </Box>
      <Box>
        <Text dimColor>Policy </Text>
        <Text>{policy.policyNumber}</Text>
        <Text dimColor> · </Text>
        <Text>{policy.insurer}</Text>
        <Text dimColor> · valid till </Text>
        <Text>{policy.validTill ?? "—"}</Text>
      </Box>
    </Box>
  );
}

function BalancePanel({ policy, balance }: { policy: Policy; balance: OpdBalance }): JSX.Element {
  return (
    <Box flexDirection="row" gap={2}>
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
    <Box flexDirection="column" borderStyle="round" paddingX={1} flexGrow={1}>
      <Text bold>{label}</Text>
      <Text color={color}>{bar}</Text>
      <Box>
        <Text dimColor>total: </Text>
        <Text>₹ {fmt(total)}</Text>
      </Box>
      <Box>
        <Text dimColor>used:  </Text>
        <Text>₹ {fmt(used)}</Text>
      </Box>
      <Box>
        <Text dimColor>left:  </Text>
        <Text color={color}>₹ {fmt(remaining)}</Text>
      </Box>
    </Box>
  );
}

function BeneficiariesPanel({ policy }: { policy: Policy }): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} flexGrow={1}>
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

function RecentClaimsSummary({ claims }: { claims: Claim[] }): JSX.Element {
  const recent = claims.slice(0, 5);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Recent claims (showing {recent.length} of {claims.length})</Text>
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
