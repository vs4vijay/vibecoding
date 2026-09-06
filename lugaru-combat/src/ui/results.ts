/**
 * Results overlay — shows after all waves are cleared.
 *
 * Displays: score total, breakdown (label × count), elapsed time,
 * best-per-difficulty from localStorage. Buttons: Retry / Menu.
 *
 * Pure DOM — no three/Rapier.
 */

import type { Difficulty } from '../types';
import type { ScoreBreakdownRow } from '../combat/scoring';
import { injectUIStyles, el } from './dom';

/** Formatted result the game layer passes in. */
export interface ResultsData {
  total: number;
  breakdown: readonly ScoreBreakdownRow[];
  elapsedMs: number;
  bests: Record<Difficulty, number> | null;
  difficulty: Difficulty;
}

export class ResultsOverlay {
  private readonly root: HTMLDivElement;
  private onRetry: (() => void) | null = null;
  private onMenu: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    injectUIStyles();
    this.root = el('div', 'lg-overlay lg-backdrop lg-results');
    this.root.classList.add('hidden');
    parent.appendChild(this.root);
  }

  show(data: ResultsData, onRetry: () => void, onMenu: () => void): void {
    this.onRetry = onRetry;
    this.onMenu = onMenu;
    this.root.innerHTML = '';

    this.root.appendChild(el('h2', '', 'Results'));
    this.root.appendChild(el('div', 'lg-score-total', `Score: ${data.total}`));

    const table = el('table', '');
    for (const row of data.breakdown) {
      const tr = el('tr', '');
      tr.appendChild(el('td', '', `${row.label} ×${row.count}`));
      tr.appendChild(el('td', '', String(row.points)));
      table.appendChild(tr);
    }
    this.root.appendChild(table);

    const mm = Math.floor(data.elapsedMs / 60000);
    const ss = Math.floor((data.elapsedMs % 60000) / 1000);
    this.root.appendChild(el('div', 'lg-score-time', `Time: ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`));

    if (data.bests) {
      const bestLines = (['easy', 'normal', 'hard'] as Difficulty[])
        .filter((d) => data.bests![d] !== undefined)
        .map((d) => `${d.charAt(0).toUpperCase() + d.slice(1)}: ${data.bests![d]}`)
        .join('  |  ');
      if (bestLines) this.root.appendChild(el('div', 'lg-score-best', `Best: ${bestLines}`));
    }

    const btnRow = el('div', 'lg-menu-row');
    const retryBtn = el('button', 'lg-btn', 'Retry');
    retryBtn.addEventListener('click', () => this.onRetry?.());
    const menuBtn = el('button', 'lg-btn', 'Menu');
    menuBtn.addEventListener('click', () => this.onMenu?.());
    btnRow.appendChild(retryBtn);
    btnRow.appendChild(menuBtn);
    this.root.appendChild(btnRow);

    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.onRetry = null;
    this.onMenu = null;
  }
}
