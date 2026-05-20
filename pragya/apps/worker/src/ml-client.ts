import { getConfig } from "./config";

export class MLClient {
  private base: string;
  private secret: string;

  constructor() {
    const cfg = getConfig();
    this.base = cfg.ML_BASE_URL.replace(/\/$/, "");
    this.secret = cfg.INTERNAL_SHARED_SECRET;
  }

  private async req<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": this.secret,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ML ${path} -> ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  health() {
    return fetch(`${this.base}/healthz`, {
      headers: { "X-Internal-Secret": this.secret },
    }).then((r) => r.json());
  }

  predict(body: unknown) {
    return this.req("/pipelines/predict", body);
  }

  harmonise(body: unknown) {
    return this.req("/pipelines/harmonise", body);
  }

  train(body: unknown) {
    return this.req("/pipelines/train", body);
  }

  audit(body: unknown) {
    return this.req("/pipelines/audit", body);
  }
}
