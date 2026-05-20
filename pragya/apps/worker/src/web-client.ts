import { getConfig } from "./config";

export class WebClient {
  private base: string;
  private secret: string;

  constructor() {
    const cfg = getConfig();
    this.base = cfg.WEB_INTERNAL_BASE_URL.replace(/\/$/, "");
    this.secret = cfg.INTERNAL_SHARED_SECRET;
  }

  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": this.secret,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`web ${path} -> ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  health() {
    return this.req("/api/health");
  }

  fetchNextJob() {
    return this.req("/api/internal/jobs/next", { method: "POST", body: JSON.stringify({}) }) as Promise<{
      job: null | { id: string; kind: string; payload: Record<string, unknown>; attempts: number };
    }>;
  }

  markJob(id: string, body: Record<string, unknown>) {
    return this.req(`/api/internal/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  }

  getParticipantFeatures(id: string) {
    return this.req(`/api/internal/participants/${id}/features`) as Promise<{
      participant: Record<string, unknown>;
      latest_visit: Record<string, unknown> | null;
      features: Record<string, unknown>;
    }>;
  }

  writePrediction(body: Record<string, unknown>) {
    return this.req("/api/internal/predictions", { method: "POST", body: JSON.stringify(body) });
  }

  // Harmonisation
  getCohortFeatureMatrix(body: { cohort_ids: string[]; modalities: string[] }) {
    return this.req("/api/internal/cohorts/feature-matrix", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  writeHarmonisationRun(body: Record<string, unknown>) {
    return this.req("/api/internal/harmonisation/runs", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Training
  getTrainingMatrix(body: { cohort_ids: string[]; modalities: string[]; harmonisation_run_id?: string }) {
    return this.req("/api/internal/training/matrix", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  writeModel(body: Record<string, unknown>) {
    return this.req("/api/internal/models", { method: "POST", body: JSON.stringify(body) });
  }

  writeAudit(body: Record<string, unknown>) {
    return this.req("/api/internal/audits", { method: "POST", body: JSON.stringify(body) });
  }
}
