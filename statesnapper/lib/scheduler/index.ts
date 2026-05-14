import { getDriver } from "../db";
import { PgCronScheduler } from "./pg-cron";
import { CronerScheduler } from "./croner";

export interface Scheduler {
  register(name: string, cron: string): Promise<void>;
  unregister(name: string): Promise<void>;
  list(): Promise<{ name: string; cron: string }[]>;
}

let _scheduler: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (_scheduler) return _scheduler;
  _scheduler = getDriver() === "postgres" ? new PgCronScheduler() : new CronerScheduler();
  return _scheduler;
}

export function resetScheduler() {
  _scheduler = null;
}
