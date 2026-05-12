import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { SessionExpiredError, type MediAssistClient } from "../api/client.ts";
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
import type { UserContext } from "../api/user-context.ts";
import { extractClaim } from "../extract/index.ts";
import { BILL_TYPES, type BillType, type ClaimFields } from "../types.ts";
import { CycleSelector } from "./components/cycle-selector.tsx";
import { SessionContext } from "./app.tsx";

type Props = {
  client: MediAssistClient;
  user: UserContext;
  /** True when this view is mounted and overlay (help/palette) isn't open. */
  isActive: boolean;
  /** Called when the user opens / closes the dry-run overlay so the parent's
   *  keybinding bar can swap to overlay-specific hints. */
  onContextHintsChange?: (hints: { key: string; label: string }[]) => void;
};

type FileKind = "bill" | "doc";

type Bill = {
  file: string;
  fields?: ClaimFields;
  error?: string;
  extracting: boolean;
  kind: FileKind;
  manualKind?: boolean;
};

type Panel = "input" | "files" | "edit" | "beneficiary";

type EditableField =
  | "billType"
  | "billNumber"
  | "billDate"
  | "billAmount"
  | "clinicName"
  | "pincode"
  | "beneficiaryHint"
  | "natureOfIllness";

const FIELD_ORDER: { key: EditableField; label: string; kind: "text" | "number" | "select" }[] = [
  { key: "billType", label: "Bill type", kind: "select" },
  { key: "billNumber", label: "Bill #", kind: "text" },
  { key: "billDate", label: "Date (DD-MM-YYYY)", kind: "text" },
  { key: "billAmount", label: "Amount (₹)", kind: "number" },
  { key: "clinicName", label: "Clinic", kind: "text" },
  { key: "pincode", label: "Pincode", kind: "text" },
  { key: "beneficiaryHint", label: "Patient hint", kind: "text" },
  { key: "natureOfIllness", label: "Nature", kind: "text" },
];

type Resolved = {
  billType?: BillTypeEntry;
  pincode?: PincodeLocality;
  loading: boolean;
};

export function NewClaim({ client, user, isActive, onContextHintsChange }: Props): JSX.Element {
  const { reportExpired } = useContext(SessionContext);
  const [bills, setBills] = useState<Bill[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("input");
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [fieldIdx, setFieldIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const [benefs, setBenefs] = useState<SubmitBeneficiary[]>([]);
  const [banks, setBanks] = useState<BankDetail[]>([]);
  const [benefIdx, setBenefIdx] = useState(0);
  const [resolved, setResolved] = useState<Resolved>({ loading: false });
  const [overlay, setOverlay] = useState<null | { payloads: Payloads; total: number }>(null);

  // ----- one-time data load (beneficiaries + bank) -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, k] = await Promise.all([getSubmitBeneficiaries(client), getBankDetails(client)]);
        if (cancelled) return;
        setBenefs(b);
        setBanks(k);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof SessionExpiredError) {
          reportExpired();
          return;
        }
        setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, reportExpired]);

  // ----- compute current selection -----
  const selectedFile = bills[selectedFileIdx];
  const billsOnly = useMemo(
    () => bills.filter((b): b is Bill & { fields: ClaimFields } => b.kind === "bill" && !!b.fields),
    [bills],
  );
  const total = useMemo(() => billsOnly.reduce((s, b) => s + b.fields.billAmount, 0), [billsOnly]);

  // ----- auto-pick the most likely beneficiary when bills arrive -----
  useEffect(() => {
    const hint = billsOnly[0]?.fields.beneficiaryHint;
    if (hint && benefs.length > 0) {
      const i = autoMatchBeneficiary(benefs, hint);
      if (i >= 0) setBenefIdx(i);
    }
  }, [billsOnly, benefs]);

  // ----- resolve bill type + pincode whenever the primary bill changes -----
  useEffect(() => {
    let cancelled = false;
    const primary = billsOnly[0]?.fields;
    if (!primary) {
      setResolved({ loading: false });
      return;
    }
    const benef = benefs[benefIdx];
    if (!benef) return;
    setResolved((r) => ({ ...r, loading: true }));
    (async () => {
      try {
        const [types, localities] = await Promise.all([
          getBillTypes(client, benef.policyId),
          primary.pincode ? lookupPincode(client, primary.pincode) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const billType = matchBillType(types, primary.billType) ?? undefined;
        const pincode = localities[0] ?? undefined;
        setResolved({ billType, pincode, loading: false });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof SessionExpiredError) {
          reportExpired();
          return;
        }
        setResolved({ loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, billsOnly, benefs, benefIdx, reportExpired]);

  // ----- context-sensitive footer hints -----
  useEffect(() => {
    if (!isActive) return;
    if (overlay) {
      onContextHintsChange?.([{ key: "esc", label: "close" }]);
      return;
    }
    const hints = getContextHints(panel, editing, bills.length, billsOnly.length);
    onContextHintsChange?.(hints);
  }, [panel, editing, bills.length, billsOnly.length, overlay, isActive, onContextHintsChange]);

  // ----- key bindings -----
  useInput(
    (input, key) => {
      // Overlay swallows everything except esc.
      if (overlay) {
        if (key.escape) setOverlay(null);
        return;
      }
      // Editing a text field — only handle Esc, TextInput owns the rest.
      if (editing) {
        if (key.escape) {
          setEditing(false);
          setEditBuffer("");
        }
        return;
      }
      if (key.tab) {
        cyclePanel();
        return;
      }
      if (input === "p") {
        void buildOverlay();
        return;
      }
      switch (panel) {
        case "input":
          return; // TextInput owns input keys
        case "files":
          handleFilesKeys(input, key);
          return;
        case "edit":
          handleEditKeys(input, key);
          return;
        case "beneficiary":
          handleBeneficiaryKeys(input, key);
          return;
      }
    },
    { isActive },
  );

  const cyclePanel = useCallback(() => {
    setPanel((p) => {
      const order: Panel[] = ["input", "files", "edit", "beneficiary"];
      const hasFiles = bills.length > 0;
      const hasEdit = !!(selectedFile && selectedFile.kind === "bill");
      const hasBenef = benefs.length > 0;
      const avail = order.filter((x) => {
        if (x === "input") return true;
        if (x === "files") return hasFiles;
        if (x === "edit") return hasEdit;
        if (x === "beneficiary") return hasBenef;
        return false;
      });
      const i = avail.indexOf(p);
      return avail[(i + 1) % avail.length] ?? "input";
    });
    setEditing(false);
  }, [bills.length, selectedFile, benefs.length]);

  // ----- handlers -----

  function addPaths(raw: string): void {
    const paths = parsePathsFromInput(raw);
    if (paths.length === 0) return;
    let added = 0;
    let skipped = 0;
    const newBills: Bill[] = [];
    setBills((prev) => {
      const seen = new Set(prev.map((b) => b.file));
      for (const p of paths) {
        if (seen.has(p)) {
          skipped++;
          continue;
        }
        if (!existsSync(p)) {
          setError(`File not found: ${p}`);
          continue;
        }
        const b: Bill = { file: p, extracting: true, kind: "doc" };
        newBills.push(b);
        seen.add(p);
        added++;
      }
      return [...prev, ...newBills];
    });
    setPathInput("");
    if (added > 0) setError(skipped > 0 ? `Added ${added}, skipped ${skipped} duplicate(s).` : null);

    // Kick off extractions
    for (const b of newBills) {
      const file = b.file;
      void (async () => {
        try {
          const fields = await extractClaim(file);
          setBills((prev) =>
            prev.map((x) =>
              x.file === file ? { file, fields, extracting: false, kind: inferKind(fields) } : x,
            ),
          );
        } catch (err) {
          setBills((prev) =>
            prev.map((x) =>
              x.file === file
                ? { file, extracting: false, kind: "doc", error: (err as Error).message }
                : x,
            ),
          );
        }
      })();
    }
  }

  function handleFilesKeys(input: string, key: { downArrow?: boolean; upArrow?: boolean; return?: boolean; escape?: boolean; delete?: boolean }): void {
    if (bills.length === 0) {
      setPanel("input");
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedFileIdx((i) => Math.min(i + 1, bills.length - 1));
      setFieldIdx(0);
    } else if (key.upArrow || input === "k") {
      setSelectedFileIdx((i) => Math.max(i - 1, 0));
      setFieldIdx(0);
    } else if (input === "t" || input === "b" || input === "d") {
      const target = bills[selectedFileIdx];
      if (!target || target.extracting) return;
      const newKind: FileKind =
        input === "b" ? "bill" : input === "d" ? "doc" : target.kind === "bill" ? "doc" : "bill";
      setBills((prev) =>
        prev.map((x, i) => (i === selectedFileIdx ? { ...x, kind: newKind, manualKind: true } : x)),
      );
    } else if (input === "x" || key.delete) {
      setBills((prev) => prev.filter((_, i) => i !== selectedFileIdx));
      setSelectedFileIdx((i) => Math.min(i, bills.length - 2 >= 0 ? bills.length - 2 : 0));
    } else if (key.return) {
      // Enter on selected file → focus its edit panel (if bill)
      const target = bills[selectedFileIdx];
      if (target && target.kind === "bill") setPanel("edit");
    } else if (input === "i") {
      setPanel("input");
    } else if (key.escape) {
      setPanel("input");
    }
  }

  function handleEditKeys(input: string, key: { downArrow?: boolean; upArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean; return?: boolean; escape?: boolean }): void {
    const bill = selectedFile;
    if (!bill || !bill.fields || bill.kind !== "bill") {
      setPanel("files");
      return;
    }
    const f = FIELD_ORDER[fieldIdx]!;
    if (key.downArrow || input === "j") {
      setFieldIdx((i) => Math.min(i + 1, FIELD_ORDER.length - 1));
    } else if (key.upArrow || input === "k") {
      setFieldIdx((i) => Math.max(i - 1, 0));
    } else if (f.kind === "select" && (key.leftArrow || input === "h")) {
      cycleBillType(bill.file, -1);
    } else if (f.kind === "select" && (key.rightArrow || input === "l")) {
      cycleBillType(bill.file, +1);
    } else if (key.return) {
      if (f.kind === "select") cycleBillType(bill.file, +1);
      else {
        setEditBuffer(stringifyField(bill.fields, f.key));
        setEditing(true);
      }
    } else if (key.escape) {
      setPanel("files");
    }
  }

  function handleBeneficiaryKeys(input: string, key: { leftArrow?: boolean; rightArrow?: boolean; escape?: boolean }): void {
    if (benefs.length === 0) return;
    if (key.leftArrow || input === "h" || input === "k") {
      setBenefIdx((i) => (i - 1 + benefs.length) % benefs.length);
    } else if (key.rightArrow || input === "l" || input === "j") {
      setBenefIdx((i) => (i + 1) % benefs.length);
    } else if (key.escape) {
      setPanel("edit");
    }
  }

  function cycleBillType(file: string, delta: number): void {
    setBills((prev) =>
      prev.map((b) => {
        if (b.file !== file || !b.fields) return b;
        const idx = BILL_TYPES.indexOf(b.fields.billType);
        const next = BILL_TYPES[(idx + delta + BILL_TYPES.length) % BILL_TYPES.length]!;
        return { ...b, fields: { ...b.fields, billType: next } };
      }),
    );
  }

  function saveEdit(): void {
    const bill = selectedFile;
    if (!bill || !bill.fields) return;
    const f = FIELD_ORDER[fieldIdx]!;
    const updated = applyFieldEdit(bill.fields, f.key, editBuffer);
    setBills((prev) =>
      prev.map((x) => (x.file === bill.file ? { ...x, fields: updated } : x)),
    );
    setEditing(false);
    setEditBuffer("");
  }

  async function buildOverlay(): Promise<void> {
    if (billsOnly.length === 0) {
      setError("No bills detected. Mark at least one file as a bill ([t] / [b] in the files panel).");
      return;
    }
    const benef = benefs[benefIdx];
    if (!benef) {
      setError("No beneficiary loaded yet.");
      return;
    }
    if (!resolved.billType) {
      setError("Bill type lookup hasn't resolved yet.");
      return;
    }
    const bank = banks.find((b) => b.isActive && b.isPrimary) ?? banks[0];
    if (!bank) {
      setError("No bank account on policy.");
      return;
    }
    const primary = billsOnly[0]!.fields;
    const allFilePaths = bills.map((b) => b.file);

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
      empId: user.empId || benef.employeeCode,
      entityId: user.entityId || benef.entityId,
      email: user.email || benef.email,
      mobile: user.mobile,
      cityId: resolved.pincode?.cityId ?? 0,
      cityName: resolved.pincode?.cityName ?? "",
      stateId: resolved.pincode?.stateId ?? 0,
      stateName: resolved.pincode?.stateName ?? "",
      pincode: primary.pincode ?? "",
      locality: resolved.pincode?.locationName ?? "",
      billTypeId: resolved.billType.id,
      hospitalName: primary.clinicName,
      totalDocCount: allFilePaths.length,
    };
    const payloads = buildPayloadsForDryRun(
      billsOnly.map((b) => b.fields),
      ctx,
      allFilePaths,
    );
    setOverlay({ payloads, total });
  }

  if (overlay) {
    return (
      <DryRunOverlay
        bills={bills}
        billsOnly={billsOnly}
        benef={benefs[benefIdx]!}
        billType={resolved.billType!}
        pincode={resolved.pincode ?? null}
        payloads={overlay.payloads}
        total={overlay.total}
      />
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <FilesPanel
        bills={bills}
        selectedIdx={selectedFileIdx}
        pathInput={pathInput}
        focused={panel === "input" || panel === "files"}
        inputFocused={panel === "input"}
        onPathChange={(v) => setPathInput(stripQuotes(v))}
        onPathSubmit={addPaths}
        error={error}
      />
      <Box marginTop={1}>
        <EditPanel
          bill={selectedFile}
          fieldIdx={fieldIdx}
          editing={editing}
          editBuffer={editBuffer}
          focused={panel === "edit"}
          onChangeBuffer={setEditBuffer}
          onSubmitEdit={saveEdit}
        />
      </Box>
      <Box marginTop={1}>
        <BeneficiaryPanel
          benefs={benefs}
          selectedIdx={benefIdx}
          focused={panel === "beneficiary"}
        />
      </Box>
      <Box marginTop={1}>
        <ResolvedBar
          billCount={billsOnly.length}
          docCount={bills.filter((b) => b.kind === "doc").length}
          total={total}
          benef={benefs[benefIdx]}
          resolved={resolved}
        />
      </Box>
    </Box>
  );
}

// ============================================================================
// Panels
// ============================================================================

function FilesPanel({
  bills,
  selectedIdx,
  pathInput,
  focused,
  inputFocused,
  onPathChange,
  onPathSubmit,
  error,
}: {
  bills: Bill[];
  selectedIdx: number;
  pathInput: string;
  focused: boolean;
  inputFocused: boolean;
  onPathChange: (v: string) => void;
  onPathSubmit: (v: string) => void;
  error: string | null;
}): JSX.Element {
  const billCount = bills.filter((b) => b.kind === "bill").length;
  const docCount = bills.length - billCount;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? "cyan" : "gray"}
      paddingX={1}
    >
      <Box>
        <Text bold>Files</Text>
        <Text dimColor>
          {"  "}({bills.length} · bills:{billCount} docs:{docCount})
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={inputFocused ? "cyan" : "gray"}>{inputFocused ? "›" : "‹"} </Text>
        <TextInput
          value={pathInput}
          focus={inputFocused}
          onChange={onPathChange}
          onSubmit={onPathSubmit}
          placeholder="drop file(s) or paste path(s) — multiple paths OK, then [enter]"
        />
      </Box>
      {error ? (
        <Text color={error.startsWith("Added") ? "green" : "red"}>{error}</Text>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        {bills.length === 0 ? (
          <Text dimColor>(no files yet — drop or paste paths above)</Text>
        ) : (
          bills.map((b, i) => (
            <FileRow
              key={b.file}
              bill={b}
              idx={i}
              selected={!inputFocused && focused && i === selectedIdx}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

function FileRow({ bill, idx, selected }: { bill: Bill; idx: number; selected: boolean }): JSX.Element {
  const f = bill.fields;
  const tag = bill.kind === "bill" ? "bill" : "doc";
  const tagColor = bill.kind === "bill" ? "cyan" : "yellow";
  return (
    <Box>
      <Text inverse={selected}>{selected ? "▶ " : "  "}</Text>
      <Text inverse={selected} dimColor>{`${idx + 1}.`.padEnd(3)}</Text>
      <Text inverse={selected}>{truncate(basename(bill.file), 34).padEnd(34)}</Text>
      <Text inverse={selected} color={tagColor} bold>
        [{tag}{bill.manualKind ? "*" : ""}]
      </Text>
      <Text inverse={selected}> </Text>
      {bill.extracting ? (
        <Text inverse={selected} color="cyan">extracting…</Text>
      ) : bill.error ? (
        <Text inverse={selected} color="red">{bill.error}</Text>
      ) : f && bill.kind === "bill" ? (
        <Box>
          <Text inverse={selected}>{f.billType.padEnd(18)}</Text>
          <Text inverse={selected}>{(f.billNumber || "—").padEnd(11)}</Text>
          <Text inverse={selected} color={selected ? undefined : "cyan"}>
            {`₹ ${fmt(f.billAmount)}`.padStart(10)}
          </Text>
          <Text inverse={selected} dimColor> · </Text>
          <Text inverse={selected}>{f.beneficiaryHint ?? "—"}</Text>
        </Box>
      ) : f ? (
        <Text inverse={selected} dimColor>(supporting document)</Text>
      ) : null}
    </Box>
  );
}

function EditPanel({
  bill,
  fieldIdx,
  editing,
  editBuffer,
  focused,
  onChangeBuffer,
  onSubmitEdit,
}: {
  bill: Bill | undefined;
  fieldIdx: number;
  editing: boolean;
  editBuffer: string;
  focused: boolean;
  onChangeBuffer: (v: string) => void;
  onSubmitEdit: () => void;
}): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
      <Box>
        <Text bold>Edit</Text>
        {bill ? (
          <Text dimColor>{"  "}· {basename(bill.file)} · [{bill.kind}]</Text>
        ) : null}
      </Box>
      {!bill ? (
        <Text dimColor>Select a file in the Files panel to edit.</Text>
      ) : bill.kind !== "bill" || !bill.fields ? (
        <Text dimColor>
          {bill.error
            ? `Extraction failed: ${bill.error}`
            : bill.extracting
              ? "Extracting…"
              : "Supporting document — no editable fields. Press [b] in Files to mark as a bill."}
        </Text>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {FIELD_ORDER.map((f, i) => {
            const selected = focused && i === fieldIdx;
            const isEditingThis = selected && editing;
            const value = stringifyField(bill.fields!, f.key);
            return (
              <Box key={f.key}>
                <Text inverse={selected && !editing}>{selected ? "▶ " : "  "}</Text>
                <Text inverse={selected && !editing} dimColor>
                  {f.label.padEnd(20)}
                </Text>
                {isEditingThis ? (
                  <Box>
                    <Text> </Text>
                    <TextInput
                      value={editBuffer}
                      focus={true}
                      onChange={onChangeBuffer}
                      onSubmit={onSubmitEdit}
                    />
                  </Box>
                ) : f.kind === "select" ? (
                  <Box>
                    <Text> </Text>
                    <Text inverse={selected} color="cyan">{value}</Text>
                    {selected ? <Text dimColor>  ←/→ cycle</Text> : null}
                  </Box>
                ) : (
                  <Text inverse={selected}>{" "}{truncate(value || "(empty)", 60)}</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function BeneficiaryPanel({
  benefs,
  selectedIdx,
  focused,
}: {
  benefs: SubmitBeneficiary[];
  selectedIdx: number;
  focused: boolean;
}): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
      <Text bold>Beneficiary</Text>
      <Box marginTop={1}>
        <CycleSelector
          items={benefs}
          selectedIndex={selectedIdx}
          isFocused={focused}
          render={(b) => `${b.name}  (${b.relation}, ${b.age}y)`}
        />
      </Box>
    </Box>
  );
}

function ResolvedBar({
  billCount,
  docCount,
  total,
  benef,
  resolved,
}: {
  billCount: number;
  docCount: number;
  total: number;
  benef: SubmitBeneficiary | undefined;
  resolved: Resolved;
}): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold dimColor>Resolved </Text>
        {resolved.loading ? <Text color="yellow">⟳ updating…</Text> : null}
      </Box>
      <Box>
        <Text dimColor>{"  "}claim:  </Text>
        <Text>{billCount} bill(s), {docCount} doc(s), total ₹ {fmt(total)}</Text>
      </Box>
      <Box>
        <Text dimColor>{"  "}benef:  </Text>
        <Text>{benef ? `${benef.name} (${benef.relation}, ${benef.age}y) · MAID ${benef.maid}` : "—"}</Text>
      </Box>
      <Box>
        <Text dimColor>{"  "}billTy: </Text>
        <Text>{resolved.billType ? `${resolved.billType.name} = ${resolved.billType.id}` : (resolved.loading ? "…" : "—")}</Text>
      </Box>
      <Box>
        <Text dimColor>{"  "}pincd:  </Text>
        <Text>
          {resolved.pincode
            ? `${resolved.pincode.pincode} → ${resolved.pincode.locationName}, ${resolved.pincode.cityName}, ${resolved.pincode.stateName}`
            : resolved.loading
              ? "…"
              : "—"}
        </Text>
      </Box>
    </Box>
  );
}

function DryRunOverlay({
  bills,
  billsOnly,
  benef,
  billType,
  pincode,
  payloads,
  total,
}: {
  bills: Bill[];
  billsOnly: (Bill & { fields: ClaimFields })[];
  benef: SubmitBeneficiary;
  billType: BillTypeEntry;
  pincode: PincodeLocality | null;
  payloads: Payloads;
  total: number;
}): JSX.Element {
  const docCount = bills.filter((b) => b.kind === "doc").length;
  const numPosts = 2 + payloads.fileUploads.length + payloads.addClaimBills.length;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={2} paddingY={1}>
        <Text bold color="yellow">
          DRY RUN — nothing was submitted  ·  {billsOnly.length} bill(s), {docCount} doc(s)  ·  total ₹ {fmt(total)}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <KV k="Beneficiary" v={`${benef.name} (${benef.relation}, ${benef.age}y) — MAID ${benef.maid}`} />
          <KV k="Bill type"   v={`${billType.name} = ${billType.id}`} />
          <KV
            k="Pincode"
            v={pincode ? `${pincode.pincode} → ${pincode.locationName}, ${pincode.cityName}, ${pincode.stateName}` : "—"}
          />
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold dimColor>What would be sent ({numPosts} POSTs)</Text>
        <PayloadSummary
          label="1. SaveDraft"
          body={payloads.saveDraft}
          keys={["claimRegnNo", "policyId", "maid", "benefName", "TreatmentStartDate", "TreatmentEndDate", "TotalDocCount", "TotalBillAmount"]}
        />
        {payloads.fileUploads.map((u, i) => (
          <Box key={`upload-${i}`} flexDirection="column" marginTop={1}>
            <Text color="cyan">{2 + i}. POST {u.endpoint} (multipart)</Text>
            <Text dimColor>  Filedata = {basename(u.filePath)}</Text>
          </Box>
        ))}
        {payloads.addClaimBills.map((body, i) => (
          <PayloadSummary
            key={`bill-${i}`}
            label={`${2 + payloads.fileUploads.length + i}. AddClaimBill (${i + 1}/${payloads.addClaimBills.length})`}
            body={body}
            keys={["billNum", "billAmnt", "billDate", "billId", "billDesc"]}
          />
        ))}
        <PayloadSummary
          label={`${numPosts}. SubmitClaim`}
          body={payloads.submitClaim}
          keys={["empid", "Entity", "mobileno", "chequeleafId", "TotalBillAmount"]}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[esc] close · for full payload run </Text>
        <Text color="cyan" bold>bun run cli submit &lt;file…&gt;</Text>
      </Box>
    </Box>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getContextHints(panel: Panel, editing: boolean, fileCount: number, billCount: number): { key: string; label: string }[] {
  if (editing) return [{ key: "enter", label: "save" }, { key: "esc", label: "cancel" }];
  const proceed = billCount > 0 ? [{ key: "p", label: "preview dry-run" }] : [];
  const nextPanel = [{ key: "tab", label: "next panel" }];
  switch (panel) {
    case "input":
      return [
        { key: "enter", label: fileCount > 0 ? "add file (empty → review)" : "add file(s)" },
        ...nextPanel,
        ...proceed,
      ];
    case "files":
      return [
        { key: "↑/↓", label: "move" },
        { key: "enter", label: "edit selected" },
        { key: "t/b/d", label: "set kind" },
        { key: "x", label: "remove" },
        { key: "i / esc", label: "back to input" },
        ...nextPanel,
        ...proceed,
      ];
    case "edit":
      return [
        { key: "↑/↓", label: "field" },
        { key: "enter", label: "edit value" },
        { key: "←/→", label: "cycle (select fields)" },
        { key: "esc", label: "back to files" },
        ...nextPanel,
        ...proceed,
      ];
    case "beneficiary":
      return [
        { key: "←/→", label: "cycle beneficiary" },
        { key: "esc", label: "back to edit" },
        ...nextPanel,
        ...proceed,
      ];
  }
}

function inferKind(fields: ClaimFields | undefined): FileKind {
  if (!fields) return "doc";
  const hasNum = fields.billNumber.trim().length > 0;
  const hasAmount = fields.billAmount > 0;
  const hasContext = !!fields.billDate || !!fields.clinicName;
  return hasNum && hasAmount && hasContext ? "bill" : "doc";
}

function autoMatchBeneficiary(benefs: SubmitBeneficiary[], hint: string | undefined): number {
  if (!hint) return benefs.findIndex((b) => b.relation.toLowerCase() === "self");
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
  return benefs.findIndex((b) => b.relation.toLowerCase() === "self");
}

/**
 * Parse one or more paths from a single text-input value. Handles all the
 * common ways terminals deliver dropped files: a single bare path, a single
 * quoted path with spaces, multiple paths separated by newlines (multi-drop),
 * or multiple `"path1" "path2"` quoted segments.
 */
function parsePathsFromInput(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (/[\r\n]/.test(trimmed)) {
    return trimmed
      .split(/[\r\n]+/)
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean);
  }

  // If the entire input (after outer quote strip) is an existing file, it's a
  // single path that probably contains spaces — keep it whole.
  const stripped = stripQuotes(trimmed);
  if (existsSync(stripped)) return [stripped];

  // Otherwise tokenize, respecting double-quote groups.
  const tokens: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of trimmed) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === " ") {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens.filter(Boolean);
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

function stringifyField(fields: ClaimFields, key: EditableField): string {
  switch (key) {
    case "billType":
      return fields.billType;
    case "billNumber":
      return fields.billNumber;
    case "billDate":
      return fields.billDate;
    case "billAmount":
      return String(fields.billAmount);
    case "clinicName":
      return fields.clinicName;
    case "pincode":
      return fields.pincode ?? "";
    case "beneficiaryHint":
      return fields.beneficiaryHint ?? "";
    case "natureOfIllness":
      return fields.natureOfIllness;
  }
}

function applyFieldEdit(fields: ClaimFields, key: EditableField, raw: string): ClaimFields {
  const trimmed = raw.trim();
  switch (key) {
    case "billType":
      return BILL_TYPES.includes(trimmed as BillType) ? { ...fields, billType: trimmed as BillType } : fields;
    case "billNumber":
      return { ...fields, billNumber: trimmed };
    case "billDate":
      return { ...fields, billDate: trimmed };
    case "billAmount": {
      const n = Number(trimmed.replace(/[,₹\s]/g, ""));
      return Number.isNaN(n) ? fields : { ...fields, billAmount: Math.round(n) };
    }
    case "clinicName":
      return { ...fields, clinicName: trimmed };
    case "pincode":
      return { ...fields, pincode: trimmed || undefined };
    case "beneficiaryHint":
      return { ...fields, beneficiaryHint: trimmed || undefined };
    case "natureOfIllness":
      return { ...fields, natureOfIllness: trimmed };
  }
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

function KV({ k, v, color }: { k: string; v: string; color?: string }): JSX.Element {
  return (
    <Box>
      <Text dimColor>{k.padEnd(13)}</Text>
      <Text color={color}>{v}</Text>
    </Box>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s || "<empty>";
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
