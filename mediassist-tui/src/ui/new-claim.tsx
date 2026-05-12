import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { useEffect, useState } from "react";
import type { MediAssistClient } from "../api/client.ts";
import { getBankDetails, type BankDetail } from "../api/bank.ts";
import {
  getBillTypes,
  lookupPincode,
  matchBillType,
  type BillTypeEntry,
  type PincodeLocality,
} from "../api/lookups.ts";
import { getSubmitBeneficiaries, type SubmitBeneficiary } from "../api/policy.ts";
import { buildPayloadsForDryRun, type Payloads, type SubmitContext } from "../api/submit.ts";
import { getUserContext, type UserContext } from "../api/user-context.ts";
import { extractClaim } from "../extract/index.ts";
import type { ClaimFields } from "../types.ts";
import { FocusableList, type Column } from "./components/focusable-list.tsx";

type Props = {
  client: MediAssistClient;
  isFocused: boolean;
};

type Bill = {
  file: string;
  fields?: ClaimFields;
  error?: string;
  extracting: boolean;
};

type Stage =
  | { kind: "addFiles"; value: string; bills: Bill[]; error?: string }
  | {
      kind: "review";
      bills: Bill[];
      benefs: SubmitBeneficiary[];
      selectedBenef: number;
      user: UserContext;
      banks: BankDetail[];
    }
  | { kind: "resolving"; message: string }
  | {
      kind: "dryRun";
      bills: Bill[];
      payloads: Payloads;
      benef: SubmitBeneficiary;
      pincode: PincodeLocality | null;
      billType: BillTypeEntry;
      total: number;
    }
  | { kind: "error"; message: string };

export function NewClaim({ client, isFocused }: Props): JSX.Element {
  const [stage, setStage] = useState<Stage>({ kind: "addFiles", value: "", bills: [] });

  useInput(
    (input, key) => {
      if (stage.kind === "review") {
        if (key.downArrow || input === "j") {
          setStage({
            ...stage,
            selectedBenef: Math.min(stage.selectedBenef + 1, stage.benefs.length - 1),
          });
        } else if (key.upArrow || input === "k") {
          setStage({ ...stage, selectedBenef: Math.max(stage.selectedBenef - 1, 0) });
        } else if (key.return) {
          void resolveAndShow(stage, client, setStage);
        } else if (key.escape) {
          setStage({ kind: "addFiles", value: "", bills: stage.bills });
        }
      } else if (stage.kind === "dryRun" || stage.kind === "error") {
        if (key.escape || input === "n") setStage({ kind: "addFiles", value: "", bills: [] });
      }
    },
    { isActive: isFocused },
  );

  switch (stage.kind) {
    case "addFiles":
      return (
        <AddFiles stage={stage} setStage={setStage} client={client} isFocused={isFocused} />
      );
    case "review":
      return <Review stage={stage} />;
    case "resolving":
      return <Loading text={stage.message} />;
    case "dryRun":
      return <DryRun stage={stage} />;
    case "error":
      return <ErrorView message={stage.message} />;
  }
}

// ---------- Stage: add files ----------

function AddFiles({
  stage,
  setStage,
  client,
  isFocused,
}: {
  stage: Extract<Stage, { kind: "addFiles" }>;
  setStage: (s: Stage) => void;
  client: MediAssistClient;
  isFocused: boolean;
}): JSX.Element {
  const removeBill = (idx: number): void => {
    setStage({ ...stage, bills: stage.bills.filter((_, i) => i !== idx) });
  };

  const onSubmit = (raw: string): void => {
    const path = stripQuotes(raw.trim());

    // Empty Enter with files queued = proceed to review.
    if (path.length === 0) {
      if (stage.bills.length === 0) {
        setStage({ ...stage, error: "Add at least one file (drop or paste a path)." });
        return;
      }
      if (stage.bills.some((b) => b.extracting)) {
        setStage({ ...stage, error: "Wait for files to finish extracting first." });
        return;
      }
      if (stage.bills.every((b) => !!b.error || !b.fields)) {
        setStage({ ...stage, error: "All queued files failed to extract." });
        return;
      }
      void enterReview(stage.bills, client, setStage);
      return;
    }

    if (!existsSync(path)) {
      setStage({ ...stage, value: path, error: `File not found: ${path}` });
      return;
    }
    if (stage.bills.some((b) => b.file === path)) {
      setStage({ ...stage, value: "", error: "Already added." });
      return;
    }

    const newBill: Bill = { file: path, extracting: true };
    const nextBills = [...stage.bills, newBill];
    setStage({ kind: "addFiles", value: "", bills: nextBills });

    // Extract in the background; merge into stage when done.
    void (async () => {
      try {
        const fields = await extractClaim(path);
        setStage({
          ...stage,
          value: "",
          bills: replaceBill(nextBills, path, { file: path, fields, extracting: false }),
        });
      } catch (err) {
        setStage({
          ...stage,
          value: "",
          bills: replaceBill(nextBills, path, {
            file: path,
            error: (err as Error).message,
            extracting: false,
          }),
        });
      }
    })();
  };

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={isFocused ? "cyan" : "gray"}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="cyan">New claim — add files</Text>
        <Text dimColor>
          Drag &amp; drop PDFs / images onto this terminal (most terminals paste the path) — add as many
          as you want; each becomes a bill on the same claim.
        </Text>
        <Box marginTop={1}>
          <Text color="cyan">› </Text>
          {isFocused ? (
            <TextInput
              value={stage.value}
              onChange={(v) => setStage({ ...stage, value: stripQuotes(v), error: undefined })}
              onSubmit={onSubmit}
              placeholder="drop or paste a path, then [enter]"
            />
          ) : (
            <Text dimColor>(switch to this tab to type)</Text>
          )}
        </Box>
        {stage.error ? (
          <Box marginTop={1}>
            <Text color="red">⚠ {stage.error}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text dimColor>[enter] add file  ·  empty [enter] proceed to review  ·  [esc] back</Text>
        </Box>
      </Box>

      {stage.bills.length > 0 ? (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Box>
            <Text bold>Bills queued ({stage.bills.length})</Text>
            <Text dimColor> — total ₹ {fmt(stage.bills.reduce((s, b) => s + (b.fields?.billAmount ?? 0), 0))}</Text>
          </Box>
          {stage.bills.map((b, i) => (
            <BillRow key={b.file} bill={b} idx={i} onRemove={() => removeBill(i)} />
          ))}
          <Box marginTop={1}>
            <Text dimColor>(Bills are kept across re-edits; press [esc] from review to come back.)</Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function BillRow({ bill, idx, onRemove }: { bill: Bill; idx: number; onRemove: () => void }): JSX.Element {
  const f = bill.fields;
  return (
    <Box>
      <Text dimColor>{`${idx + 1}.`.padEnd(3)}</Text>
      <Text>{basename(bill.file).padEnd(36)}</Text>
      {bill.extracting ? (
        <Text color="cyan"> extracting…</Text>
      ) : bill.error ? (
        <Text color="red"> error: {bill.error}</Text>
      ) : f ? (
        <Box>
          <Text>{f.billType.padEnd(18)}</Text>
          <Text>{(f.billNumber || "—").padEnd(11)}</Text>
          <Text>{(f.billDate || "—").padEnd(11)}</Text>
          <Text color="cyan">{`₹ ${fmt(f.billAmount)}`.padStart(10)}</Text>
          <Text dimColor> · </Text>
          <Text>{f.beneficiaryHint ?? "—"}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function replaceBill(bills: Bill[], file: string, next: Bill): Bill[] {
  return bills.map((b) => (b.file === file ? next : b));
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

async function enterReview(
  bills: Bill[],
  client: MediAssistClient,
  setStage: (s: Stage) => void,
): Promise<void> {
  try {
    const [user, benefs, banks] = await Promise.all([
      getUserContext(client),
      getSubmitBeneficiaries(client),
      getBankDetails(client),
    ]);
    const billsWithFields = bills.filter((b) => b.fields);
    const hint = billsWithFields[0]?.fields?.beneficiaryHint;
    const initial = autoMatchBeneficiary(benefs, hint);
    setStage({
      kind: "review",
      bills,
      benefs,
      user,
      banks,
      selectedBenef: initial,
    });
  } catch (err) {
    setStage({ kind: "error", message: (err as Error).message });
  }
}

function autoMatchBeneficiary(benefs: SubmitBeneficiary[], hint: string | undefined): number {
  if (!hint) {
    const selfIdx = benefs.findIndex((b) => b.relation.toLowerCase() === "self");
    return selfIdx >= 0 ? selfIdx : 0;
  }
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const h = norm(hint);
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < benefs.length; i++) {
    const b = benefs[i]!;
    const name = norm(b.name);
    let score = 0;
    if (name === h) score = 4;
    else if (name.startsWith(h)) score = 3;
    else if (name.includes(h) || h.includes(name.split(" ")[0]!)) score = 2;
    else if ((name.split(" ")[0] ?? "") === (h.split(" ")[0] ?? "")) score = 1;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) return bestIdx;
  const selfIdx = benefs.findIndex((b) => b.relation.toLowerCase() === "self");
  return selfIdx >= 0 ? selfIdx : 0;
}

// ---------- Stage: review ----------

function Review({
  stage,
}: {
  stage: Extract<Stage, { kind: "review" }>;
}): JSX.Element {
  const billsWithFields = stage.bills.filter((b): b is Bill & { fields: ClaimFields } => !!b.fields);
  const total = billsWithFields.reduce((s, b) => s + b.fields.billAmount, 0);
  const distinctHints = [...new Set(billsWithFields.map((b) => b.fields.beneficiaryHint).filter(Boolean))];

  const columns: Column<SubmitBeneficiary>[] = [
    { header: "Name", width: 28, render: (b) => b.name },
    { header: "Relation", width: 12, render: (b) => b.relation },
    { header: "Age", width: 5, align: "right", render: (b) => `${b.age}y` },
  ];

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Text bold color="cyan">Review bills</Text>
          <Text dimColor> ({billsWithFields.length}, total ₹ {fmt(total)})</Text>
        </Box>
        {billsWithFields.map((b, i) => (
          <Box key={b.file}>
            <Text dimColor>{`${i + 1}.`.padEnd(3)}</Text>
            <Text>{basename(b.file).padEnd(32)}</Text>
            <Text>{b.fields.billType.padEnd(18)}</Text>
            <Text color="cyan">{`₹ ${fmt(b.fields.billAmount)}`.padStart(10)}</Text>
            <Text dimColor> · </Text>
            <Text>{b.fields.beneficiaryHint ?? "—"}</Text>
          </Box>
        ))}
        {distinctHints.length > 1 ? (
          <Box marginTop={1}>
            <Text color="yellow">
              ⚠ Patient hints differ ({distinctHints.join(", ")}). A claim is per-beneficiary —
              pick one or split into separate claims (esc back, remove the odd ones out).
            </Text>
          </Box>
        ) : null}
      </Box>

      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Text bold>Beneficiary</Text>
        <Text dimColor>Auto-matched from patient hint — change with [j/k] or arrows.</Text>
        <Box marginTop={1}>
          <FocusableList
            rows={stage.benefs}
            columns={columns}
            selectedIndex={stage.selectedBenef}
            viewportHeight={Math.min(stage.benefs.length, 8)}
          />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[enter] resolve &amp; show dry-run  ·  [esc] back to file list</Text>
      </Box>
    </Box>
  );
}

async function resolveAndShow(
  stage: Extract<Stage, { kind: "review" }>,
  client: MediAssistClient,
  setStage: (s: Stage) => void,
): Promise<void> {
  const benef = stage.benefs[stage.selectedBenef];
  if (!benef) {
    setStage({ kind: "error", message: "No beneficiary selected" });
    return;
  }
  const billsWithFields = stage.bills.filter((b): b is Bill & { fields: ClaimFields } => !!b.fields);
  if (billsWithFields.length === 0) {
    setStage({ kind: "error", message: "No bills to submit" });
    return;
  }

  setStage({ kind: "resolving", message: "Looking up bill type, pincode, bank…" });
  try {
    // All bills share the same beneficiary's policy. For pincode we use the
    // first bill's pincode (claim-level address); individual bills can carry
    // their own pincode but the portal stores one hospital per claim.
    const primary = billsWithFields[0]!.fields;
    const [types, localities] = await Promise.all([
      getBillTypes(client, benef.policyId),
      primary.pincode ? lookupPincode(client, primary.pincode) : Promise.resolve([]),
    ]);
    const billType = matchBillType(types, primary.billType);
    if (!billType) {
      setStage({
        kind: "error",
        message:
          `Could not map bill type "${primary.billType}". Server offered: ` +
          types.map((t) => t.name).join(", "),
      });
      return;
    }
    const pincode = localities[0] ?? null;
    const bank = stage.banks.find((b) => b.isActive && b.isPrimary) ?? stage.banks[0];
    if (!bank) {
      setStage({ kind: "error", message: "No bank account on policy." });
      return;
    }

    const ctx: SubmitContext = {
      beneficiary: {
        id: benef.id,
        maid: benef.maid,
        name: benef.name,
        relation: benef.relation,
        relationId: benef.relationId,
        age: benef.age,
        alphaCode: benef.alphaCode,
        employeeCode: benef.employeeCode,
        policyId: benef.policyId,
        policyNumber: benef.policyNumber,
        insurer: benef.insurer,
      },
      bank,
      empId: stage.user.empId || benef.employeeCode,
      entityId: stage.user.entityId || benef.entityId,
      email: stage.user.email || benef.email,
      mobile: stage.user.mobile,
      cityId: pincode?.cityId ?? 0,
      cityName: pincode?.cityName ?? "",
      stateId: pincode?.stateId ?? 0,
      stateName: pincode?.stateName ?? "",
      pincode: primary.pincode ?? "",
      locality: pincode?.locationName ?? "",
      billTypeId: billType.id,
      hospitalName: primary.clinicName,
      totalDocCount: billsWithFields.length,
    };

    const payloads = buildPayloadsForDryRun(
      billsWithFields.map((b) => b.fields),
      ctx,
      billsWithFields.map((b) => b.file),
    );
    const total = billsWithFields.reduce((s, b) => s + b.fields.billAmount, 0);
    setStage({ kind: "dryRun", bills: stage.bills, payloads, benef, pincode, billType, total });
  } catch (err) {
    setStage({ kind: "error", message: (err as Error).message });
  }
}

// ---------- Stage: dry-run ----------

function DryRun({
  stage,
}: {
  stage: Extract<Stage, { kind: "dryRun" }>;
}): JSX.Element {
  const { bills, payloads, benef, pincode, billType, total } = stage;
  const billsWithFields = bills.filter((b): b is Bill & { fields: ClaimFields } => !!b.fields);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={2} paddingY={1}>
        <Text bold color="yellow">
          DRY RUN — nothing was submitted  ·  {billsWithFields.length} bill(s)  ·  total ₹ {fmt(total)}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <KV k="Beneficiary" v={`${benef.name} (${benef.relation}, ${benef.age}y) — MAID ${benef.maid}`} />
          <KV k="Bill type"   v={`${billType.name} = ${billType.id}`} />
          <KV
            k="Pincode"
            v={pincode ? `${pincode.pincode} → ${pincode.locationName}, ${pincode.cityName}, ${pincode.stateName}` : "—"}
          />
          <KV k="Clinic"      v={billsWithFields[0]?.fields.clinicName ?? "—"} />
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Bills</Text>
          {billsWithFields.map((b, i) => (
            <Box key={b.file}>
              <Text dimColor>{`${i + 1}.`.padEnd(3)}</Text>
              <Text>{basename(b.file).padEnd(32)}</Text>
              <Text dimColor>{b.fields.billNumber.padEnd(12)}</Text>
              <Text dimColor>{b.fields.billDate.padEnd(11)}</Text>
              <Text color="cyan">{`₹ ${fmt(b.fields.billAmount)}`.padStart(10)}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold dimColor>
          What would be sent ({2 + payloads.fileUploads.length + payloads.addClaimBills.length} POSTs)
        </Text>
        <PayloadSummary
          label="1. SaveDraft"
          body={payloads.saveDraft}
          keys={["claimRegnNo", "policyId", "maid", "benefName", "TreatmentStartDate", "TreatmentEndDate", "TotalBillAmount"]}
        />
        {payloads.fileUploads.map((u, i) => (
          <Box key={`upload-${i}`} flexDirection="column" marginTop={1}>
            <Text color="cyan">
              {2 + i}. POST {u.endpoint} (multipart)
            </Text>
            <Text dimColor>  Filedata = {basename(u.filePath)}</Text>
          </Box>
        ))}
        {payloads.addClaimBills.map((body, i) => (
          <PayloadSummary
            key={`bill-${i}`}
            label={`${2 + payloads.fileUploads.length + i}. AddClaimBill (bill ${i + 1}/${payloads.addClaimBills.length})`}
            body={body}
            keys={["billNum", "billAmnt", "billDate", "billId", "billDesc"]}
          />
        ))}
        <PayloadSummary
          label={`${2 + payloads.fileUploads.length + payloads.addClaimBills.length}. SubmitClaim`}
          body={payloads.submitClaim}
          keys={["empid", "Entity", "mobileno", "chequeleafId", "TotalBillAmount"]}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[esc] / [n] new claim  ·  for the full payload run </Text>
        <Text color="cyan" bold>bun run cli submit &lt;file…&gt;</Text>
      </Box>
    </Box>
  );
}

function PayloadSummary({
  label,
  body,
  keys,
}: {
  label: string;
  body: Record<string, string>;
  keys?: string[];
}): JSX.Element {
  const fields = keys ?? Object.keys(body);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan">{label}</Text>
      {fields.map((k) => (
        <Box key={k}>
          <Text dimColor>  {k.padEnd(18)} </Text>
          <Text>{truncate(body[k] ?? "", 60)}</Text>
        </Box>
      ))}
    </Box>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s || "<empty>";
}

// ---------- Loading / error ----------

function Loading({ text }: { text: string }): JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % 4), 120);
    return () => clearInterval(t);
  }, []);
  const dots = ".".repeat(frame);
  return (
    <Box borderStyle="round" paddingX={2} paddingY={1}>
      <Text color="cyan">{text}{dots}</Text>
    </Box>
  );
}

function ErrorView({ message }: { message: string }): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
      <Text bold color="red">Error</Text>
      <Text>{message}</Text>
      <Text dimColor>[esc] start over</Text>
    </Box>
  );
}

function KV({ k, v, color }: { k: string; v: string; color?: string }): JSX.Element {
  return (
    <Box>
      <Text dimColor>{k.padEnd(13)}</Text>
      <Text color={color}>{v}</Text>
    </Box>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
