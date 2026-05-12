import { Box, Text, useInput } from "ink";
import { useContext, useEffect, useState } from "react";
import { SessionExpiredError, type MediAssistClient } from "../api/client.ts";
import { listClaims } from "../api/claims.ts";
import type { Claim } from "../types.ts";
import { FocusableList, type Column } from "./components/focusable-list.tsx";
import { SessionContext } from "./app.tsx";

type Props = {
  client: MediAssistClient;
  refreshKey: number;
  isActive: boolean;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; claims: Claim[] };

/**
 * lazygit-style split pane:
 *  - left  (50%): scrollable claims list (focusable)
 *  - right (50%): auto-syncs to show the selected claim's detail
 *
 * Tab cycles focus between the two panels (the right panel is read-only,
 * so cycling onto it just dims the list cursor).
 */
export function ClaimsView({ client, refreshKey, isActive }: Props): JSX.Element {
  const { reportExpired } = useContext(SessionContext);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState(0);
  const [pane, setPane] = useState<"list" | "detail">("list");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      try {
        const claims = await listClaims(client);
        if (!cancelled) {
          setState({ kind: "ready", claims });
          setSelected(0);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof SessionExpiredError) {
          reportExpired();
          return;
        }
        setState({ kind: "error", message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, refreshKey, reportExpired]);

  useInput(
    (input, key) => {
      if (state.kind !== "ready") return;
      if (key.tab) {
        setPane((p) => (p === "list" ? "detail" : "list"));
        return;
      }
      if (pane !== "list") {
        if (key.escape || input === "h" || key.leftArrow) setPane("list");
        return;
      }
      const count = state.claims.length;
      if (count === 0) return;
      if (key.downArrow || input === "j") setSelected((s) => Math.min(s + 1, count - 1));
      else if (key.upArrow || input === "k") setSelected((s) => Math.max(s - 1, 0));
      else if (input === "g") setSelected(0);
      else if (input === "G") setSelected(count - 1);
      else if (key.pageDown) setSelected((s) => Math.min(s + 10, count - 1));
      else if (key.pageUp) setSelected((s) => Math.max(s - 10, 0));
      else if (key.return || input === "l" || key.rightArrow) setPane("detail");
    },
    { isActive },
  );

  if (state.kind === "loading") return <Text color="cyan">Loading claims…</Text>;
  if (state.kind === "error") return <Text color="red">Error: {state.message}</Text>;

  const claim = state.claims[selected];
  const columns: Column<Claim>[] = [
    { header: "Date", width: 11, render: (c) => c.submittedOn },
    { header: "Beneficiary", width: 18, render: (c) => c.beneficiary },
    {
      header: "Amount",
      width: 10,
      align: "right",
      render: (c) => `₹ ${c.amount.toLocaleString("en-IN")}`,
      color: () => "cyan",
    },
    { header: "Status", render: (c) => c.status, color: (c) => statusColor(c.status) },
  ];

  return (
    <Box flexDirection="row" gap={1} paddingX={1}>
      <Box
        flexDirection="column"
        flexBasis="50%"
        borderStyle="round"
        borderColor={pane === "list" ? "cyan" : "gray"}
        paddingX={1}
      >
        <Box>
          <Text bold>Claims </Text>
          <Text dimColor>({state.claims.length})</Text>
        </Box>
        <Box marginTop={1}>
          <FocusableList
            rows={state.claims}
            columns={columns}
            selectedIndex={selected}
            viewportHeight={16}
          />
        </Box>
      </Box>
      <Box
        flexDirection="column"
        flexBasis="50%"
        borderStyle="round"
        borderColor={pane === "detail" ? "cyan" : "gray"}
        paddingX={1}
      >
        {claim ? <ClaimDetail claim={claim} /> : <Text dimColor>No claim selected.</Text>}
      </Box>
    </Box>
  );
}

function ClaimDetail({ claim }: { claim: Claim }): JSX.Element {
  const raw = claim.raw as Record<string, unknown> | undefined;
  const ailment = (raw?.["Ailment"] as string | undefined)?.trim() || "—";
  const polId = (raw?.["PolicyId"] as number | string | undefined) ?? "—";
  const relation = (raw?.["BenefRelation"] as string | undefined) ?? "—";
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Claim detail</Text>
      <KV k="Claim #"     v={claim.claimNumber} />
      <KV k="Beneficiary" v={`${claim.beneficiary} (${relation})`} />
      <KV k="Submitted"   v={claim.submittedOn} />
      <KV k="Type"        v={claim.billType ?? "—"} />
      <KV k="Claimed"     v={`₹ ${claim.amount.toLocaleString("en-IN")}`} />
      <KV
        k="Approved"
        v={claim.approvedAmount ? `₹ ${claim.approvedAmount.toLocaleString("en-IN")}` : "—"}
      />
      <KV k="Status"      v={claim.status} color={statusColor(claim.status)} />
      <KV k="Ailment"     v={ailment} />
      <KV k="Policy"      v={String(polId)} />
    </Box>
  );
}

function KV({ k, v, color }: { k: string; v: string; color?: string }): JSX.Element {
  return (
    <Box>
      <Text dimColor>{k.padEnd(14)}</Text>
      <Text color={color}>{v}</Text>
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
