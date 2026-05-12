import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { MediAssistClient } from "../api/client.ts";
import { getOpdBalance, getPolicy, type OpdBalance } from "../api/policy.ts";
import { listClaims } from "../api/claims.ts";
import { getUserContext, type UserContext } from "../api/user-context.ts";
import type { Claim, Policy } from "../types.ts";
import type { Screen } from "./app.tsx";

type DashboardProps = {
  client: MediAssistClient;
  onNavigate: (s: Screen) => void;
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

export function Dashboard({ client, onNavigate }: DashboardProps): JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);

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

  useInput((input) => {
    const k = input.toLowerCase();
    if (k === "r") setRefreshKey((n) => n + 1);
    if (k === "n") onNavigate("newClaim");
    if (k === "c") onNavigate("claims");
  });

  if (state.kind === "loading") {
    return (
      <Box>
        <Text color="cyan">Loading dashboard…</Text>
      </Box>
    );
  }

  if (state.kind === "error") {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {state.message}</Text>
        <Text dimColor>Press [R] to retry  [Q] to quit</Text>
      </Box>
    );
  }

  const { user, policy, balance, claims } = state;

  return (
    <Box flexDirection="column">
      <Header user={user} policy={policy} />
      <BalanceBox policy={policy} balance={balance} />
      <BeneficiariesBox policy={policy} />
      <RecentClaimsBox claims={claims} />
      <Footer />
    </Box>
  );
}

function Header({ user, policy }: { user: UserContext; policy: Policy }): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text bold color="cyan">Medi Assist </Text>
        <Text>· </Text>
        <Text bold>{user.fullName}</Text>
        <Text dimColor> ({user.empId})</Text>
        <Text dimColor> @ </Text>
        <Text>{user.entityCode}</Text>
      </Box>
      <Box>
        <Text dimColor>Policy </Text>
        <Text>{policy.policyNumber}</Text>
        <Text dimColor> · valid till </Text>
        <Text>{policy.validTill ?? "—"}</Text>
        <Text dimColor> · </Text>
        <Text>{policy.insurer}</Text>
      </Box>
    </Box>
  );
}

function BalanceBox({ policy, balance }: { policy: Policy; balance: OpdBalance }): JSX.Element {
  const usedSI = policy.sumInsured - policy.available;
  const usedOpd = balance.familyLimit - balance.familyBalance;
  return (
    <Box flexDirection="row" gap={2} marginTop={1}>
      <Bar
        label="Sum Insured (family)"
        total={policy.sumInsured}
        used={usedSI}
        remaining={policy.available}
      />
      <Bar
        label="OPD (family)"
        total={balance.familyLimit}
        used={usedOpd}
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
  const width = 32;
  const ratio = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const remainingColor = ratio > 0.9 ? "red" : ratio > 0.7 ? "yellow" : "green";
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} flexGrow={1}>
      <Text bold>{label}</Text>
      <Box>
        <Text color={remainingColor}>{bar}</Text>
      </Box>
      <Box>
        <Text>Total ₹ {fmt(total)}</Text>
        <Text dimColor>   ·   used ₹ {fmt(used)}   ·   </Text>
        <Text color={remainingColor}>remaining ₹ {fmt(remaining)}</Text>
      </Box>
    </Box>
  );
}

function BeneficiariesBox({ policy }: { policy: Policy }): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
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

function RecentClaimsBox({ claims }: { claims: Claim[] }): JSX.Element {
  const recent = claims.slice(0, 8);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
      <Text bold>Recent claims ({recent.length} of {claims.length})</Text>
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
        </>
      )}
    </Box>
  );
}

function Footer(): JSX.Element {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        [N] New claim   [C] Claims list   [R] Refresh   [Q] Quit
      </Text>
    </Box>
  );
}

function statusColor(s: string): "green" | "yellow" | "red" | "gray" | "white" {
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
