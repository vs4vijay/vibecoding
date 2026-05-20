import { z } from "zod";
import { getConfig } from "../config";
import {
  HealthResponse,
  PredictRequest,
  PredictResponse,
  HarmoniseRequest,
  HarmoniseResponse,
  TrainRequest,
  TrainResponse,
  AuditRequest,
  AuditResponse,
} from "@drishti/shared";

class MLClient {
  private baseUrl: string;
  private secret: string;

  constructor() {
    const cfg = getConfig();
    this.baseUrl = cfg.ML_BASE_URL.replace(/\/$/, "");
    this.secret = cfg.INTERNAL_SHARED_SECRET;
  }

  private async req<T>(path: string, body: unknown, schema: z.ZodType<T>, method = "POST"): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": this.secret,
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ML ${path} -> ${res.status}: ${text}`);
    }
    const json = await res.json();
    return schema.parse(json);
  }

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/healthz`, {
      headers: { "X-Internal-Secret": this.secret },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ML /healthz -> ${res.status}`);
    return HealthResponse.parse(await res.json());
  }

  predict(req: PredictRequest) {
    return this.req("/pipelines/predict", req, PredictResponse);
  }

  harmonise(req: HarmoniseRequest) {
    return this.req("/pipelines/harmonise", req, HarmoniseResponse);
  }

  train(req: TrainRequest) {
    return this.req("/pipelines/train", req, TrainResponse);
  }

  audit(req: AuditRequest) {
    return this.req("/pipelines/audit", req, AuditResponse);
  }
}

let cached: MLClient | undefined;
export function mlClient() {
  if (!cached) cached = new MLClient();
  return cached;
}
