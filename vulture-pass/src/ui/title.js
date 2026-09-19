// Title screen (9.2): pulp title card with Continue (when a save exists) and
// New Game; New Game while a save exists asks before overwriting (spec).

import { loadGame } from '../engine/save.js';

export function createTitleScreen({ onContinue, onNewGame }) {
  const root = document.createElement('div');
  root.id = 'title-screen';
  document.getElementById('ui-root').appendChild(root);

  // Continue only when a save exists AND loads (corrupt/unknown → new game only)
  let saveExists = !!loadGame();

  function render(mode = 'main') {
    if (mode === 'confirm') {
      root.innerHTML = `
        <div class="title-wrap">
          <div class="title-card panel">
            <div class="panel-title">Overwrite save?</div>
            <p class="title-note">Starting fresh erases your current run — day, money, cargo, the works.</p>
            <div class="map-actions" style="justify-content:center">
              <button class="btn btn-danger" id="title-yes">Erase &amp; start new</button>
              <button class="btn btn-ghost" id="title-no">Keep playing</button>
            </div>
          </div>
        </div>
      `;
      root.querySelector('#title-yes').addEventListener('click', () => {
        root.remove();
        onNewGame();
      });
      root.querySelector('#title-no').addEventListener('click', () => render('main'));
      return;
    }

    root.innerHTML = `
      <div class="title-wrap">
        <div class="title-art">
          <svg viewBox="0 0 200 120" class="title-svg">
            <defs>
              <pattern id="titletone" width="4" height="4" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.5" fill="#2b1d12"/>
              </pattern>
            </defs>
            <rect width="200" height="120" fill="#d8b36a"/>
            <circle cx="160" cy="24" r="16" fill="#b3541e" opacity="0.55"/>
            <path d="M 10 74 L 34 40 L 58 40 L 78 74 Z" fill="#a97b4e" opacity="0.85"/>
            <path d="M 120 78 L 142 50 L 170 50 L 190 78 Z" fill="#a97b4e" opacity="0.7"/>
            <path d="M 0 96 L 200 86" stroke="#5c4a38" stroke-width="14" fill="none"/>
            <path d="M 14 96 L 48 92" stroke="#d8c79a" stroke-width="1.6" stroke-dasharray="9 7"/>
            <path d="M 70 91 L 110 88" stroke="#d8c79a" stroke-width="1.6" stroke-dasharray="9 7"/>
            <path d="M 130 87.5 L 168 85" stroke="#d8c79a" stroke-width="1.6" stroke-dasharray="9 7"/>
            <g transform="translate(96 78)">
              <rect x="-16" y="-8" width="34" height="11" rx="3" fill="#f2e3c2"/>
              <rect x="-9" y="-15" width="17" height="8" rx="3" fill="#2b1d12"/>
              <rect x="2" y="-6" width="10" height="3" fill="#b3541e"/>
              <circle cx="-9" cy="4" r="4" fill="#26201a"/>
              <circle cx="9" cy="4" r="4" fill="#26201a"/>
              <ellipse cx="-24" cy="6" rx="10" ry="3.4" fill="#d9bd85" opacity="0.8"/>
            </g>
            <path d="M 150 34 q -12 -9 -24 -3 q 9 1 14 6 q 5 -4 10 0 q 5 -4 10 0 q 5 -4 14 -3 q -12 -8 -24 0 Z" fill="#2b1d12"/>
            <rect width="200" height="120" fill="url(#titletone)" opacity="0.18"/>
          </svg>
          <div class="title-logo">
            <div class="title-logo-top">VULTURE</div>
            <div class="title-logo-bottom">PASS</div>
            <div class="title-tag">a car-combat trading story of the Cholla Basin</div>
          </div>
        </div>
        <div class="title-actions">
          ${saveExists ? '<button class="btn" id="title-continue">Continue</button>' : ''}
          <button class="btn ${saveExists ? 'btn-ghost' : ''}" id="title-new">New Game</button>
        </div>
        <div class="title-credit">an original homage — drive, trade, fight, survive</div>
      </div>
    `;
    root.querySelector('#title-continue')?.addEventListener('click', () => {
      root.remove();
      onContinue();
    });
    root.querySelector('#title-new').addEventListener('click', () => {
      if (loadGame()) render('confirm');
      else {
        root.remove();
        onNewGame();
      }
    });
  }

  render('main');

  return { root, destroy: () => root.remove() };
}
