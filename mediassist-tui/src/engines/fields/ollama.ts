import type { ClaimFields } from "../../types.ts";
import { BILL_TYPES } from "../../types.ts";
import type { FieldExtractor } from "../types.ts";

const SYSTEM_PROMPT = "You extract structured fields from medical invoice text. Output JSON only.";

export const ollamaFieldExtractor: FieldExtractor = {
  name: "ollama",
  available: () => !!process.env.OLLAMA_HOST,
  async extract(text: string, partial?: ClaimFields): Promise<ClaimFields> {
    if (!partial) {
      // Without a prior pass we still try, but the prompt is more open-ended.
      partial = emptyFields(text);
    }

    const host = (process.env.OLLAMA_HOST ?? "").replace(/\/$/, "");
    const model = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";
    if (!host) return partial;

    const fieldsToFill = neededFields(partial);
    if (fieldsToFill.length === 0) return partial;

    try {
      const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildPrompt(text, partial, fieldsToFill) },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return partial;
      const body = (await res.json()) as { message?: { content?: string } };
      const content = body.message?.content?.trim() ?? "";
      if (!content) return partial;
      const filled = JSON.parse(content) as Partial<ClaimFields>;
      return mergeFilled(partial, filled);
    } catch {
      return partial;
    }
  },
};

function emptyFields(rawText: string): ClaimFields {
  return {
    billType: "OPD-Consultation",
    billAmount: 0,
    billNumber: "",
    billDate: "",
    clinicName: "",
    natureOfIllness: "",
    rawText,
    confidence: {},
  };
}

function neededFields(partial: ClaimFields): string[] {
  const conf = partial.confidence ?? {};
  const out = new Set<string>();
  for (const k of ["billNumber", "billDate", "billAmount", "clinicName", "natureOfIllness"] as const) {
    if (!partial[k]) out.add(k);
  }
  for (const [k, c] of Object.entries(conf)) {
    if ((c as number) < 0.6) out.add(k);
  }
  return [...out];
}

function buildPrompt(text: string, partial: ClaimFields, fieldsToFill: string[]): string {
  const known = {
    billType: partial.billType,
    billNumber: partial.billNumber,
    billDate: partial.billDate,
    billAmount: partial.billAmount,
    clinicName: partial.clinicName,
    pincode: partial.pincode,
    natureOfIllness: partial.natureOfIllness,
    beneficiaryHint: partial.beneficiaryHint,
  };
  return `Invoice text:
"""
${text.slice(0, 4000)}
"""

Already extracted (keep unless empty or wrong):
${JSON.stringify(known, null, 2)}

Output a JSON object filling these fields if you can (omit a key if unsure):
- billType: one of ${JSON.stringify(BILL_TYPES)}
- billNumber: invoice or receipt number
- billDate: DD-MM-YYYY
- billAmount: total in INR as a number
- clinicName: vendor / clinic / hospital name
- pincode: 6-digit Indian pincode if visible
- natureOfIllness: short description
- beneficiaryHint: patient name if mentioned

Fields most needed: ${fieldsToFill.join(", ")}.`;
}

function mergeFilled(prev: ClaimFields, filled: Partial<ClaimFields>): ClaimFields {
  const out: ClaimFields = { ...prev, confidence: { ...(prev.confidence ?? {}) } };
  for (const [k, v] of Object.entries(filled) as [keyof ClaimFields, unknown][]) {
    if (v === undefined || v === null || v === "") continue;
    if (out[k] === undefined || out[k] === "" || out[k] === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[k] = v;
      (out.confidence as Record<string, number>)[k] = 0.75;
    }
  }
  return out;
}
