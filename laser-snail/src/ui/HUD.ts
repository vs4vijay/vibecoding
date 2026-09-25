/**
 * In-race DOM HUD: score, postal-meter pips, progress bar, damage vignette
 * and the mute hint. All feedback is instant (CSS transitions / Web
 * Animations under 200 ms) so every event reads within the 100 ms budget.
 * Fullscreen flow screens (menu / pause / results / game over) live in
 * Screens.ts.
 */

export interface HUDOptions {
  /** Element the HUD attaches to. Defaults to document.body. */
  container?: HTMLElement;
}

const STYLE_ID = 'laser-snail-hud-style';
const ROOT_ID = 'laser-snail-hud';

const STYLES = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: system-ui, "Segoe UI", sans-serif;
  user-select: none;
  z-index: 10;
}
#${ROOT_ID}.sm-hidden {
  display: none;
}
#${ROOT_ID} .sm-topbar {
  position: absolute;
  top: 22px;
  left: 26px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
#${ROOT_ID} .sm-score-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: #5cc9e0;
}
#${ROOT_ID} .sm-score-value {
  font-size: clamp(24px, 3.4vw, 38px);
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #e9fbff;
  text-shadow: 0 0 14px rgba(63, 242, 255, 0.8), 0 0 38px rgba(63, 242, 255, 0.35);
}
#${ROOT_ID} .sm-pips {
  display: flex;
  gap: 8px;
}
#${ROOT_ID} .sm-pip {
  width: 20px;
  height: 20px;
  font-size: 19px;
  line-height: 20px;
  text-align: center;
  color: rgba(255, 79, 125, 0.18);
  text-shadow: none;
  transition: color 120ms ease, text-shadow 120ms ease, transform 120ms ease;
}
#${ROOT_ID} .sm-pip.filled {
  color: #ff5f8f;
  text-shadow: 0 0 10px rgba(255, 79, 125, 0.95), 0 0 26px rgba(255, 79, 125, 0.5);
}
#${ROOT_ID} .sm-pip.restored {
  transform: scale(1.45);
}
#${ROOT_ID} .sm-weapon-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: #5cc9e0;
}
#${ROOT_ID} .sm-weapon-value {
  display: inline-block;
  margin-top: 2px;
  font-size: clamp(15px, 2vw, 21px);
  font-weight: 800;
  letter-spacing: 0.14em;
  color: #d7f9ff;
  text-shadow: 0 0 12px rgba(63, 242, 255, 0.75);
}
#${ROOT_ID} .sm-weapon-value.sm-invincible {
  color: #fff3b0;
  text-shadow: 0 0 12px rgba(255, 236, 130, 0.95), 0 0 30px rgba(255, 220, 90, 0.5);
}
#${ROOT_ID} .sm-progress {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  width: min(560px, 78vw);
  height: 10px;
  border-radius: 999px;
  border: 1px solid rgba(63, 242, 255, 0.45);
  background: rgba(10, 16, 40, 0.65);
  overflow: hidden;
}
#${ROOT_ID} .sm-progress-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: linear-gradient(90deg, #1596ac, #3ff2ff);
  box-shadow: 0 0 14px rgba(63, 242, 255, 0.85);
  transition: width 80ms linear;
}
#${ROOT_ID} .sm-flash {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(ellipse at center, rgba(255, 79, 125, 0) 42%, rgba(255, 79, 125, 0.4) 100%);
}
#${ROOT_ID} .sm-bomb-flash {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(ellipse at center, rgba(255, 244, 180, 0.85) 0%, rgba(255, 214, 90, 0.35) 55%, rgba(255, 214, 90, 0) 100%);
}
#${ROOT_ID} .sm-danger {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(ellipse at center, rgba(255, 42, 84, 0) 44%, rgba(255, 42, 84, 0.44) 100%);
  transition: opacity 140ms ease;
}
#${ROOT_ID} .sm-danger.active {
  opacity: 1;
  animation: sm-danger-pulse 1s ease-in-out infinite;
}
@keyframes sm-danger-pulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.45); }
}
#${ROOT_ID} .sm-mute-hint {
  position: absolute;
  right: 24px;
  bottom: 22px;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: rgba(143, 232, 255, 0.55);
}
#${ROOT_ID} .sm-mute-hint strong {
  color: rgba(143, 232, 255, 0.9);
  font-weight: 600;
}
`;

export class HUD {
  private readonly root: HTMLDivElement;
  private readonly scoreValue: HTMLDivElement;
  private readonly pips: HTMLDivElement[] = [];
  private readonly weaponValue: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly bombFlash: HTMLDivElement;
  private readonly danger: HTMLDivElement;
  private readonly muteHint: HTMLDivElement;

  public constructor(options: HUDOptions = {}) {
    const container = options.container ?? document.body;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.id = ROOT_ID;

    const topbar = document.createElement('div');
    topbar.className = 'sm-topbar';

    const scoreLabel = document.createElement('div');
    scoreLabel.className = 'sm-score-label';
    scoreLabel.textContent = 'SCORE';
    this.scoreValue = document.createElement('div');
    this.scoreValue.className = 'sm-score-value';
    this.scoreValue.textContent = '0';

    const pipsRow = document.createElement('div');
    pipsRow.className = 'sm-pips';
    for (let i = 0; i < 3; i += 1) {
      const pip = document.createElement('div');
      pip.className = 'sm-pip filled';
      pip.textContent = '♥';
      this.pips.push(pip);
      pipsRow.appendChild(pip);
    }

    const weaponLabel = document.createElement('div');
    weaponLabel.className = 'sm-weapon-label';
    weaponLabel.textContent = 'CANNON';
    this.weaponValue = document.createElement('div');
    this.weaponValue.className = 'sm-weapon-value';
    this.weaponValue.textContent = 'Single';

    topbar.append(scoreLabel, this.scoreValue, pipsRow, weaponLabel, this.weaponValue);

    const progress = document.createElement('div');
    progress.className = 'sm-progress';
    this.fill = document.createElement('div');
    this.fill.className = 'sm-progress-fill';
    progress.appendChild(this.fill);

    this.flash = document.createElement('div');
    this.flash.className = 'sm-flash';

    this.bombFlash = document.createElement('div');
    this.bombFlash.className = 'sm-bomb-flash';

    this.danger = document.createElement('div');
    this.danger.className = 'sm-danger';

    this.muteHint = document.createElement('div');
    this.muteHint.className = 'sm-mute-hint';

    this.root.append(topbar, progress, this.flash, this.bombFlash, this.danger, this.muteHint);
    container.appendChild(this.root);
  }

  /** Updates the progress bar; `s` beyond `length` clamps to full. */
  public setProgress(s: number, length: number): void {
    const fraction = length > 0 ? Math.min(1, Math.max(0, s / length)) : 0;
    this.fill.style.width = `${(fraction * 100).toFixed(2)}%`;
  }

  /** Updates the score readout; `pulse` plays the pickup pop (180 ms). */
  public setScore(score: number, pulse = false): void {
    this.scoreValue.textContent = String(Math.max(0, Math.round(score)));
    if (pulse) {
      this.scoreValue.animate(
        [
          { transform: 'scale(1.28)', color: '#9ffaff' },
          { transform: 'scale(1)', color: '#e9fbff' },
        ],
        { duration: 180, easing: 'ease-out' },
      );
    }
  }

  /** Updates the postal meter; `restoredIndex` briefly pops the refilled pip. */
  public setPips(pips: number, restoredIndex = -1): void {
    for (let i = 0; i < this.pips.length; i += 1) {
      const pip = this.pips[i];
      pip.classList.toggle('filled', i < pips);
      pip.classList.toggle('restored', i === restoredIndex);
    }
    if (restoredIndex >= 0 && restoredIndex < this.pips.length) {
      window.setTimeout(() => {
        this.pips[restoredIndex]?.classList.remove('restored');
      }, 160);
    }
  }

  /** Full-screen magenta damage vignette (250 ms fade). */
  public flashDamage(): void {
    this.flash.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 250, easing: 'ease-out' },
    );
  }

  /**
   * Updates the weapon readout. `flash` (a white-ring ladder up) plays the
   * ladder flash — scale + glow pop, well inside the 100 ms feedback budget.
   */
  public setWeapon(name: string, options: { flash?: boolean; invincible?: boolean } = {}): void {
    this.weaponValue.textContent = name;
    this.weaponValue.classList.toggle('sm-invincible', options.invincible === true);
    if (options.flash) {
      this.weaponValue.animate(
        [
          { transform: 'scale(1.5)', color: '#ffffff', textShadow: '0 0 22px rgba(255, 255, 255, 1)' },
          { transform: 'scale(1)', color: '', textShadow: '' },
        ],
        { duration: 320, easing: 'ease-out' },
      );
    }
  }

  /** Smart-bomb detonation: big yellow-white screen flash (350 ms fade). */
  public flashBomb(): void {
    this.bombFlash.animate(
      [
        { opacity: 1 },
        { opacity: 0.35, offset: 0.55 },
        { opacity: 0 },
      ],
      { duration: 350, easing: 'ease-out' },
    );
  }

  /**
   * Red-ring danger vignette: a red edge overlay that snaps on (140 ms) for
   * the whole duration of the trap's speed cut, then fades away. `active`
   * is polled every sim step from the speed-mod state.
   */
  public setDanger(active: boolean): void {
    this.danger.classList.toggle('active', active);
  }

  /** Shows the "M — sound on/off" hint, bottom right. */
  public setMuteHint(muted: boolean): void {
    const strong = document.createElement('strong');
    strong.textContent = muted ? 'sound off' : 'sound on';
    this.muteHint.replaceChildren('M ', strong);
  }

  /** Hides the in-race widgets (menu/results); the race HUD stays up while paused. */
  public setVisible(visible: boolean): void {
    this.root.classList.toggle('sm-hidden', !visible);
  }

  /** Removes the HUD from the DOM. */
  public dispose(): void {
    this.root.remove();
  }
}
