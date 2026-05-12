import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { MediAssistClient } from "../api/client.ts";
import { listClaims } from "../api/claims.ts";
import type { Claim } from "../types.ts";
import { FocusableList, type Column } from "./components/focusable-list.tsx";

type Props = {
  client: MediAssistClient;
  refreshKey: number;
  /** True when this screen owns keyboard input. */
  isFocused: boolean;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; claims: Claim[] };

export function ClaimsList({ client, refreshKey, isFocused }: Props): JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState(false);

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
        if (!cancelled) setState({ kind: "error", message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, refreshKey]);

  useInput(
    (input, key) => {
      if (state.kind !== "ready") return;
      const count = state.claims.length;
      if (count === 0) return;

      if (key.downArrow || input === "j") setSelected((s) => Math.min(s + 1, count - 1));
      else if (key.upArrow || input === "k") setSelected((s) => Math.max(s - 1, 0));
      else if (input === "g") setSelected(0);
      else if (input === "G") setSelected(count - 1);
      else if (key.pageDown) setSelected((s) => Math.min(s + 10, count - 1));
      else if (key.pageUp) setSelected((s) => Math.max(s - 10, 0));
      else if (key.return || input === "l") setDetail(true);
      else if (key.escape || input === "h") setDetail(false);
    },
    { isActive: isFocused },
  );

  if (state.kind === "loading") return <Text color="cyan">Loading claims…</Text>;
  if (state.kind === "error") return <Text color="red">Error: {state.message}</Text>;

  const claim = state.claims[selected];
  const columns: Column<Claim>[] = [
    { header: "Claim #", width: 22, render: (c) => c.claimNumber },
    { header: "Beneficiary", width: 22, render: (c) => c.beneficiary },
    { header: "Date", width: 11, render: (c) => c.submittedOn },
    { header: "Type", width: 14, render: (c) => c.billType ?? "—" },
    {
      header: "Amount",
      width: 10,
      align: "right",
      render: (c) => `₹ ${c.amount.toLocaleString("en-IN")}`,
      color: () => "cyan",
    },
    {
      header: "Status",
      render: (c) => c.status,
      color: (c) => statusColor(c.status),
    },
  ];

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={isFocused ? "cyan" : "gray"}
        paddingX={1}
        flexGrow={1}
      >
        <Box>
          <Text bold>Claims</Text>
          <Text dimColor> ({state.claims.length})</Text>
          {isFocused ? (
            <Text dimColor>  · [j/k] move  [enter] view  [esc] back  [r] refresh</Text>
          ) : null}
        </Box>
        <Box marginTop={1}>
          <FocusableList rows={state.claims} columns={columns} selectedIndex={selected} viewportHeight={14} />
        </Box>
      </Box>
      {detail && claim ? <ClaimDetail claim={claim} /> : null}
    </Box>
  );
}

function ClaimDetail({ claim }: { claim: Claim }): JSX.Element {
  const raw = claim.raw as Record<string, unknown> | undefined;
  const ail = (raw?.["Ailment"] as string | undefined)?.trim() || "—";
  const polId = (raw?.["PolicyId"] as number | string | undefined) ?? "—";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text bold color="yellow">Claim detail</Text>
      <KV k="Claim #"     v={claim.claimNumber} />
      <KV k="Beneficiary" v={claim.beneficiary} />
      <KV k="Submitted"   v={claim.submittedOn} />
      <KV k="Type"        v={claim.billType ?? "—"} />
      <KV k="Claimed"     v={`₹ ${claim.amount.toLocaleString("en-IN")}`} />
      <KV k="Approved"    v={claim.approvedAmount ? `₹ ${claim.approvedAmount.toLocaleString("en-IN")}` : "—"} />
      <KV k="Status"      v={claim.status} color={statusColor(claim.status)} />
      <KV k="Ailment"     v={ail} />
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
