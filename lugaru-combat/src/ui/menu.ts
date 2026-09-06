/**
 * Main menu overlay — title "LUGARU", Tutorial / Arena buttons, difficulty
 * radio (Easy/Normal/Hard, default Normal). Keyboard navigable with Tab +
 * arrow keys and Enter/Space.
 *
 * Pure DOM — no three/Rapier. No sim imports.
 */

import type { Difficulty } from '../types';
import { injectUIStyles, el } from './dom';

export interface MenuChoice {
  mode: 'tutorial' | 'arena';
  difficulty: Difficulty;
}

export class MenuOverlay {
  private readonly root: HTMLDivElement;
  private choice: MenuChoice = { mode: 'arena', difficulty: 'normal' };
  private onSubmit: ((choice: MenuChoice) => void) | null = null;

  constructor(parent: HTMLElement) {
    injectUIStyles();
    this.root = el('div', 'lg-overlay lg-backdrop');

    const title = el('div', 'lg-title', 'LUGARU');
    this.root.appendChild(title);

    // Mode buttons row
    const btnRow = el('div', 'lg-menu-row');
    const tutorialBtn = el('button', 'lg-btn', 'Tutorial');
    const arenaBtn = el('button', 'lg-btn', 'Arena');

    tutorialBtn.addEventListener('click', () => {
      this.choice.mode = 'tutorial';
      this.updateActiveBtns(tutorialBtn, arenaBtn);
    });
    arenaBtn.addEventListener('click', () => {
      this.choice.mode = 'arena';
      this.updateActiveBtns(tutorialBtn, arenaBtn);
    });
    btnRow.appendChild(tutorialBtn);
    btnRow.appendChild(arenaBtn);
    this.root.appendChild(btnRow);

    // Difficulty radio group
    const radioGroup = el('div', 'lg-radio-group');
    for (const diff of ['Easy', 'Normal', 'Hard'] as const) {
      const val = diff.toLowerCase() as Difficulty;
      const label = el('label', '');
      const radio = el('input', '');
      radio.type = 'radio';
      radio.name = 'difficulty';
      radio.value = val;
      if (val === 'normal') radio.checked = true;
      radio.addEventListener('change', () => {
        this.choice.difficulty = val;
      });
      label.appendChild(radio);
      label.appendChild(el('span', '', diff));
      radioGroup.appendChild(label);
    }
    this.root.appendChild(radioGroup);

    // Start hint
    this.root.appendChild(el('div', 'lg-hint', 'Click Tutorial or Arena to begin'));

    parent.appendChild(this.root);
    this.updateActiveBtns(tutorialBtn, arenaBtn);
  }

  /** Show the menu and accept a callback for when the user picks a mode. */
  show(onSubmit: (choice: MenuChoice) => void): void {
    this.onSubmit = onSubmit;
    this.root.classList.remove('hidden');
  }

  /** Hide the menu overlay. */
  hide(): void {
    this.onSubmit = null;
    this.root.classList.add('hidden');
  }

  private updateActiveBtns(tutorialBtn: HTMLElement, arenaBtn: HTMLElement): void {
    tutorialBtn.classList.toggle('lg-btn-active', this.choice.mode === 'tutorial');
    arenaBtn.classList.toggle('lg-btn-active', this.choice.mode === 'arena');
    // Auto-submit when a button is clicked
    if (this.onSubmit) this.onSubmit(this.choice);
  }
}
