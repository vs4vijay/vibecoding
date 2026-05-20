import type { MLClient } from "../ml-client";
import type { WebClient } from "../web-client";
import { noopHandler } from "./noop";
import { predictHandler } from "./predict";
import { harmoniseHandler } from "./harmonise";
import { trainHandler } from "./train";
import { auditHandler } from "./audit";

export type HandlerCtx = {
  web: WebClient;
  ml: MLClient;
  workerId: string;
};

export type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type HandlerResult = {
  status: "succeeded" | "failed";
  result?: Record<string, unknown>;
  error?: string;
};

export type Handler = (job: Job, ctx: HandlerCtx) => Promise<HandlerResult>;

export const handlers: Record<string, Handler> = {
  noop: noopHandler,
  predict: predictHandler,
  harmonise: harmoniseHandler,
  train: trainHandler,
  audit: auditHandler,
};
