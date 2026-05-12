import type { ClaimFields, BillType } from "../../types.ts";
import type { FieldExtractor } from "../types.ts";

type PartialFields = { [P in keyof ClaimFields]?: ClaimFields[P] };
type Confidence = Record<string, number>;

const MONTH_TO_NUM: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

export const heuristicFieldExtractor: FieldExtractor = {
  name: "heuristic",
  available: () => true,
  async extract(text: string, partial?: ClaimFields): Promise<ClaimFields> {
    const result = extractFromText(text);
    return merge(partial, result);
  },
};

function extractFromText(rawText: string): ClaimFields {
  const norm = rawText.replace(/ /g, " ").replace(/\s+/g, " ").trim();

  const optical = tryOptical(norm);
  if (optical) return finalize(rawText, optical.fields, optical.confidence);

  const health = tryHealth(norm);
  if (health) return finalize(rawText, health.fields, health.confidence);

  return finalize(rawText, ...extractGeneric(norm));
}

function finalize(rawText: string, fields: PartialFields, confidence: Confidence): ClaimFields {
  return {
    billType: fields.billType ?? classifyBillType(rawText),
    billAmount: fields.billAmount ?? 0,
    billNumber: fields.billNumber ?? "",
    billDate: fields.billDate ?? "",
    clinicName: fields.clinicName ?? "",
    pincode: fields.pincode,
    natureOfIllness: fields.natureOfIllness ?? "",
    beneficiaryHint: fields.beneficiaryHint,
    rawText,
    confidence: confidence as ClaimFields["confidence"],
  };
}

function merge(prev: ClaimFields | undefined, next: ClaimFields): ClaimFields {
  if (!prev) return next;
  // Prefer previously-set fields with high confidence; the heuristic engine
  // is typically the first in the chain, so this branch is rarely hit.
  const out: ClaimFields = { ...next };
  const prevConf = prev.confidence ?? {};
  const nextConf = next.confidence ?? {};
  for (const key of Object.keys(out) as (keyof ClaimFields)[]) {
    if (key === "confidence" || key === "rawText") continue;
    const pc = (prevConf as Record<string, number>)[key] ?? 0;
    const nc = (nextConf as Record<string, number>)[key] ?? 0;
    if (pc > nc && prev[key]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[key] = prev[key];
    }
  }
  return out;
}

// ---------- template: Optical ----------
function tryOptical(text: string): { fields: PartialFields; confidence: Confidence } | null {
  if (!/ARJUN\s+OPTICAL/i.test(text)) return null;
  const fields: PartialFields = { clinicName: "ARJUN OPTICAL INDUSTRIES", billType: "Vision & Dental" };
  const conf: Confidence = { clinicName: 1, billType: 1 };

  const re = /\b(\d{3,6})\s+(\d{3,6})\s+([A-Z][A-Z\s]+?)\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/;
  const m = re.exec(text);
  if (m) {
    fields.billNumber = m[1];
    fields.beneficiaryHint = (m[3] ?? "").trim();
    fields.billDate = normalizeDate(m[4]!);
    conf.billNumber = 0.95;
    conf.beneficiaryHint = 0.9;
    conf.billDate = 0.95;
  }

  const totalMatch = /Grand\s+Total\s+Advance\s+([\d,]+)/i.exec(text);
  if (totalMatch) {
    fields.billAmount = parseAmount(totalMatch[1]!);
    conf.billAmount = 0.95;
  } else {
    fields.billAmount = pickLargestAmount(text);
    conf.billAmount = 0.6;
  }

  const lensLine = /LENS\s+([A-Z][A-Za-z0-9]+)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/.exec(text);
  const sphCyl =
    /(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(\d+)/.exec(text);
  if (lensLine && sphCyl) {
    fields.natureOfIllness =
      `Vision correction - ${lensLine[1]} ${lensLine[2]} lens ` +
      `(R: ${sphCyl[1]}/${sphCyl[2]}/${sphCyl[3]}, L: ${sphCyl[4]}/${sphCyl[5]}/${sphCyl[6]})`;
    conf.natureOfIllness = 0.9;
  } else {
    fields.natureOfIllness = "Vision correction - prescription lens";
    conf.natureOfIllness = 0.7;
  }

  // Station Road branch is in Ajmer 305001.
  fields.pincode = "305001";
  conf.pincode = 0.6;

  return { fields, confidence: conf };
}

// ---------- template: Augmenta Health ----------

function tryHealth(text: string): { fields: PartialFields; confidence: Confidence } | null {
  if (!/Augmenta\s+Health/i.test(text)) return null;
  const fields: PartialFields = { clinicName: " Health Pvt Ltd", billType: "OPD-Consultation" };
  const conf: Confidence = { clinicName: 1, billType: 1 };

  const inv = /Invoice\s*\/\s*Receipt\s+([A-Z0-9-]+)/i.exec(text);
  if (inv) {
    fields.billNumber = inv[1];
    conf.billNumber = 0.98;
  }

  const date = /Date\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/.exec(text);
  if (date) {
    fields.billDate = normalizeDate(date[1]!);
    conf.billDate = 0.95;
  }

  const name = /\d{4}\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(?:Male|Female)/.exec(text);
  if (name) {
    fields.beneficiaryHint = name[1];
    conf.beneficiaryHint = 0.85;
  }

  const total = /Grand\s+total\s+Rs\.?\s*([\d,.]+)/i.exec(text);
  if (total) {
    fields.billAmount = parseAmount(total[1]!);
    conf.billAmount = 0.98;
  } else {
    fields.billAmount = pickLargestAmount(text);
    conf.billAmount = 0.6;
  }

  const consult = /(Follow\s*up\s+Consultation|Consultation\s+fees?|Consultation)/i.exec(text);
  fields.natureOfIllness = consult ? consult[1]!.replace(/\s+/g, " ") : "Consultation";
  conf.natureOfIllness = 0.9;

  if (/Sivanchetty\s+Garden/i.test(text)) {
    fields.pincode = "560042";
    conf.pincode = 0.75;
  }

  return { fields, confidence: conf };
}

// ---------- generic fallback ----------

function extractGeneric(text: string): [PartialFields, Confidence] {
  const fields: PartialFields = {};
  const conf: Confidence = {};

  const firstLine = text.split(/[\r\n]/).find((l) => l.trim().length > 3);
  if (firstLine) {
    fields.clinicName = firstLine.slice(0, 80).trim();
    conf.clinicName = 0.5;
  }

  const bn =
    /(?:Invoice|Bill|Receipt)\s*(?:\/\s*Receipt)?\s*(?:No\.?|Number|#)?\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/i.exec(text);
  if (bn) {
    fields.billNumber = bn[1];
    conf.billNumber = 0.7;
  }

  const dateNum = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/.exec(text);
  const dateWord = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/.exec(text);
  if (dateNum) {
    fields.billDate = normalizeDate(dateNum[1]!);
    conf.billDate = 0.75;
  } else if (dateWord) {
    fields.billDate = normalizeDate(dateWord[1]!);
    conf.billDate = 0.75;
  }

  const grand = /Grand\s+Total\s+(?:Advance\s+)?(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  const total = /\bTotal\s+(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  if (grand) {
    fields.billAmount = parseAmount(grand[1]!);
    conf.billAmount = 0.85;
  } else if (total) {
    fields.billAmount = parseAmount(total[1]!);
    conf.billAmount = 0.75;
  } else {
    fields.billAmount = pickLargestAmount(text);
    conf.billAmount = 0.4;
  }

  const pin = /\b([1-9]\d{5})\b/.exec(text);
  if (pin) {
    fields.pincode = pin[1];
    conf.pincode = 0.5;
  }

  fields.billType = classifyBillType(text);
  conf.billType = 0.6;

  return [fields, conf];
}

// ---------- helpers ----------

function classifyBillType(text: string): BillType {
  const t = text.toLowerCase();
  if (/optical|eye[\s-]?(?:wear|test)|spectacle|lens|dental|dentist/.test(t)) return "Vision & Dental";
  if (/vaccin/i.test(t)) return "Vaccination";
  if (/pharma|pharmacy|chemist|medical\s+store|drug\s+(?:store|house)|medicines?/.test(t)) return "Pharmacy & Medicines";
  if (/(?:pathology|laboratory|diagnostic|x[\s-]?ray|ultrasound|mri|ct\s+scan|investigation)/.test(t))
    return "Investigation & Labs";
  if (/(?:master\s*check|health\s*check\s*up|preventive)/.test(t)) return "Health Check Up";
  return "OPD-Consultation";
}

function parseAmount(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : Math.round(n);
}

function pickLargestAmount(text: string): number {
  const nums: number[] = [];
  const re = /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)|\b(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (!raw) continue;
    const n = parseAmount(raw);
    if (n > 0) nums.push(n);
  }
  return nums.length > 0 ? Math.max(...nums) : 0;
}

function normalizeDate(raw: string): string {
  const numMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(raw);
  if (numMatch) {
    const [, d, m, y] = numMatch;
    const yyyy = y!.length === 2 ? (Number(y) >= 50 ? `19${y}` : `20${y}`) : y;
    return `${d!.padStart(2, "0")}-${m!.padStart(2, "0")}-${yyyy}`;
  }
  const wordMatch = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(raw);
  if (wordMatch) {
    const [, d, mon, y] = wordMatch;
    const mm = MONTH_TO_NUM[mon!.toLowerCase()];
    if (mm) return `${d!.padStart(2, "0")}-${mm}-${y}`;
  }
  return raw;
}
