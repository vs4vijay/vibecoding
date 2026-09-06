// src/world/Camera.ts
import { PHYSICS } from "../core/types";

export class Camera {
  screen: number;
  constructor(screen = 0) { this.screen = screen; }
  get offsetX(): number { return this.screen * PHYSICS.LOGICAL_W; }
  get offsetY(): number { return 0; }
  warpTo(s: number): void { this.screen = s; }
}
