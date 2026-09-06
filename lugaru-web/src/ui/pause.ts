/**
 * Pause overlay — Resume | Restart | Menu.
 *
 * Triggered by Esc, pointer-lock loss, or window blur.
 * Pure DOM — no three/Rapier.
 */

import { injectUIStyles, el } from './dom';

export class PauseOverlay {
  private readonly root: HTMLDivElement;
  private onResume: (() => void) | null = null;
  private onRestart: (() => void) | null = null;
  private onMenu: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    injectUIStyles();
    this.root = el('div', 'lg-overlay lg-backdrop');
    this.root.classList.add('hidden');
    this.root.appendChild(el('div', 'lg-pause-title', 'Paused'));

    const btnRow = el('div', 'lg-menu-row');
    const resumeBtn = el('button', 'lg-btn', 'Resume');
    resumeBtn.addEventListener('click', () => this.onResume?.());
    const restartBtn = el('button', 'lg-btn', 'Restart');
    restartBtn.addEventListener('click', () => this.onRestart?.());
    const menuBtn = el('button', 'lg-btn', 'Menu');
    menuBtn.addEventListener('click', () => this.onMenu?.());
    btnRow.appendChild(resumeBtn);
    btnRow.appendChild(restartBtn);
    btnRow.appendChild(menuBtn);
    this.root.appendChild(btnRow);

    parent.appendChild(this.root);
  }

  show(onResume: () => void, onRestart: () => void, onMenu: () => void): void {
    this.onResume = onResume;
    this.onRestart = onRestart;
    this.onMenu = onMenu;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.onResume = null;
    this.onRestart = null;
    this.onMenu = null;
    this.root.classList.add('hidden');
  }
}
