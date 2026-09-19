// Versus intro screen (8.3): player portrait vs. boss portrait with a slam
// animation, then a FIGHT button. Portraits are placeholder SVG busts.

import { palette } from '../game/data/palette.js';

export function showVersus({ leftName, leftTitle, rightName, rightTitle, onStart }) {
  const root = document.createElement('div');
  root.id = 'versus';
  root.innerHTML = `
    <div class="versus-wrap">
      <div class="versus-card left">
        ${bust(palette.playerBody, palette.playerStripe, '#f2e3c2')}
        <div class="versus-name">${leftName}</div>
        <div class="versus-sub">${leftTitle}</div>
      </div>
      <div class="versus-vs">VS</div>
      <div class="versus-card right">
        ${bust(palette.bossBody, palette.bossTrim, '#2b1d12')}
        <div class="versus-name">${rightName}</div>
        <div class="versus-sub">${rightTitle}</div>
      </div>
    </div>
    <button class="btn versus-fight" id="versus-fight">FIGHT</button>
  `;
  document.getElementById('ui-root').appendChild(root);
  root.querySelector('#versus-fight').addEventListener('click', () => {
    root.remove();
    onStart?.();
  });
  function bust(body, stripe, outline) {
    return `
    <svg viewBox="0 0 80 80" class="versus-bust">
      <rect x="0" y="0" width="80" height="80" fill="${paperBg}" />
      <circle cx="40" cy="52" r="20" fill="${body}" stroke="${outline}" stroke-width="2.5"/>
      <rect x="22" y="18" width="36" height="8" rx="3" fill="${outline}"/>
      <rect x="30" y="10" width="20" height="10" rx="3" fill="${outline}"/>
      <rect x="14" y="24" width="52" height="5" rx="2.5" fill="${stripe}"/>
      <rect x="33" y="44" width="14" height="20" rx="4" fill="${stripe}" opacity="0.85"/>
      <circle cx="33" cy="50" r="2.2" fill="${outline}"/>
      <circle cx="47" cy="50" r="2.2" fill="${outline}"/>
    </svg>`;
  }
  return {
    destroy() {
      root.remove();
    },
  };
}

const paperBg = '#d6bd8c';
