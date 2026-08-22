import { HOW_TO_LINES } from "./menus";

/**
 * First-run coach overlay: three stacked hints shown over the live run,
 * dismissed by the actions they teach (one real steer AND one shot).
 * Shown only while `zh.coachSeen` is unset; saving the flag is the
 * caller's job via markCoachSeen().
 */
export class Coach {
  private readonly wrap: HTMLElement;
  private steered = false;
  private shot = false;

  constructor(root: HTMLElement) {
    this.wrap = document.createElement("div");
    this.wrap.className = "coach hidden";
    for (const line of HOW_TO_LINES) {
      const row = document.createElement("div");
      row.className = "coach-line";
      row.textContent = line;
      this.wrap.append(row);
    }
    root.append(this.wrap);
  }

  show(): void {
    this.steered = false;
    this.shot = false;
    this.wrap.classList.remove("hidden");
  }

  /** Call when a real steering drag happens; half of the dismissal gate. */
  notifySteer(): void {
    if (this.wrap.classList.contains("hidden")) return;
    this.steered = true;
    this.refresh();
  }

  /** Call on the first successful shot; other half of the dismissal gate. */
  notifyShot(): void {
    if (this.wrap.classList.contains("hidden")) return;
    this.shot = true;
    this.refresh();
  }

  /** True once both dismissal conditions have fired since show(). */
  get done(): boolean {
    return this.steered && this.shot;
  }

  hide(): void {
    this.wrap.classList.add("hidden");
  }

  private refresh(): void {
    if (!this.done) return;
    this.hide();
  }
}
