// Comic-panel cutscene system (8.1, D11): sequential SVG panels with caption
// text, advance on click/keys, skip jumps to the end. Panels are generated
// from scripts (data/cutscenes) — placeholder illustration shapes now, real
// drawings can replace the `art` renderers later without touching this file.

import { paper } from '../game/data/palette.js';
import { sfxUi } from './sfx.js';

export function createCutscenePlayer({ onDone }) {
  let root = null;
  let script = null;
  let index = 0;

  function play(scriptId) {
    // late import breaks the ui→data cycle cleanly at runtime
    return import('../game/data/content.js').then(({ cutscenes }) => {
      script = cutscenes[scriptId];
      if (!script || !script.panels.length) {
        onDone?.();
        return;
      }
      index = 0;
      build();
      renderPanel();
    });
  }

  function build() {
    root = document.createElement('div');
    root.id = 'cutscene';
    root.innerHTML = `
      <div class="cut-head">
        <span class="cut-title">${script.title}</span>
        <button class="btn btn-ghost btn-small" id="cut-skip">Skip ⏭</button>
      </div>
      <div class="cut-stage">
        <div class="cut-panel panel" id="cut-panel"></div>
        <div class="cut-caption" id="cut-caption"></div>
      </div>
      <div class="cut-hint">click or press SPACE to continue</div>
    `;
    document.getElementById('ui-root').appendChild(root);
    root.addEventListener('click', () => advance());
    const onKey = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    root.querySelector('#cut-skip').addEventListener('click', (e) => {
      e.stopPropagation();
      finish();
    });
    root._onKey = onKey;
  }

  function renderPanel() {
    const panel = script.panels[index];
    const art = document.getElementById('cut-panel');
    const cap = document.getElementById('cut-caption');
    art.innerHTML = '';
    const svg = renderPanelArt(panel);
    art.appendChild(svg);
    // caption types in
    cap.textContent = '';
    cap.dataset.text = panel.caption;
    let i = 0;
    clearInterval(root._typer);
    root._typer = setInterval(() => {
      i += 2;
      cap.textContent = panel.caption.slice(0, i);
      if (i >= panel.caption.length) clearInterval(root._typer);
    }, 16);
    document.getElementById('cut-skip').textContent =
      index === script.panels.length - 1 ? 'End ⏭' : 'Skip ⏭';
  }

  function advance() {
    if (index < script.panels.length - 1) {
      index++;
      sfxUi('click');
      renderPanel();
    } else {
      finish();
    }
  }

  function finish() {
    clearInterval(root?._typer);
    window.removeEventListener('keydown', root?._onKey);
    root?.remove();
    root = null;
    onDone?.();
  }

  // ------------------------------------------------------------ panel art
  // One SVG per panel: layered placeholder shapes driven by the script's
  // `art` descriptor. Swap-in point for real illustrations.

  function renderPanelArt(panel) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 160 90');
    svg.classList.add('cut-svg');

    function el(name, attrs, text) {
      const e = document.createElementNS(svgNS, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text) e.textContent = text;
      svg.appendChild(e);
      return e;
    }

    const sky = panel.art?.sky ?? '#d8b36a';
    el('rect', { x: 0, y: 0, width: 160, height: 90, fill: sky });
    el('circle', { cx: 130, cy: 18, r: 10, fill: paper.accent, opacity: 0.5 });

    for (const shape of panel.art?.shapes ?? []) {
      if (shape.type === 'mesa') {
        el('path', {
          d: `M ${shape.x - 30} 62 L ${shape.x - 18} 34 L ${shape.x + 14} 34 L ${shape.x + 26} 62 Z`,
          fill: shape.color ?? '#a97b4e',
          opacity: 0.8,
        });
      } else if (shape.type === 'car') {
        const body = el('rect', { x: shape.x, y: 54, width: 26, height: 10, rx: 2, fill: shape.color ?? '#2b1d12' });
        el('rect', { x: shape.x + 5, y: 48, width: 12, height: 8, rx: 2, fill: shape.color ?? '#2b1d12' });
        el('circle', { cx: shape.x + 6, cy: 65, r: 3.4, fill: paper.ink });
        el('circle', { cx: shape.x + 20, cy: 65, r: 3.4, fill: paper.ink });
        if (shape.dust) {
          el('ellipse', { cx: shape.x - 6, cy: 66, rx: 8, ry: 3, fill: '#d9bd85', opacity: 0.7 });
        }
        void body;
      } else if (shape.type === 'road') {
        el('path', { d: `M 0 78 L 160 70`, stroke: '#5c4a38', 'stroke-width': 12, fill: 'none' });
        el('path', { d: 'M 10 78 L 40 74', stroke: paper.roadLine, 'stroke-width': 1.4, 'stroke-dasharray': '6 5' });
        el('path', { d: 'M 60 73 L 95 70.5', stroke: paper.roadLine, 'stroke-width': 1.4, 'stroke-dasharray': '6 5' });
        el('path', { d: 'M 115 70 L 150 68.5', stroke: paper.roadLine, 'stroke-width': 1.4, 'stroke-dasharray': '6 5' });
      } else if (shape.type === 'town') {
        for (let i = 0; i < 5; i++) {
          const bx = shape.x + i * 16;
          const bh = 12 + ((i * 7 + (shape.seed ?? 0)) % 14);
          el('rect', { x: bx, y: 62 - bh, width: 12, height: bh, fill: i % 2 ? '#a97b4e' : '#cf9f6a' });
        }
      } else if (shape.type === 'star') {
        el('text', { x: shape.x, y: shape.y, 'font-size': 10, fill: paper.accent }, '✷');
      } else if (shape.type === 'buzzard') {
        // crude winged silhouette
        el('path', {
          d: `M ${shape.x} ${shape.y} q -10 -8 -20 -3 q 8 1 12 5 q 4 -3 8 0 q 4 -3 8 0 q 4 -4 12 -5 q -10 -5 -20 3 Z`,
          fill: paper.ink,
        });
      } else if (shape.type === 'burst') {
        el('path', {
          d: `M ${shape.x} ${shape.y} l 8 -14 l 2 10 l 12 -6 l -6 12 l 14 2 l -12 6 l 8 10 l -14 -4 l -2 12 l -8 -12 l -10 8 l 3 -12 l -13 -2 l 12 -7 l -6 -11 Z`,
          fill: '#e07b2e',
          opacity: 0.9,
        });
      } else if (shape.type === 'text') {
        el('text', {
          x: shape.x,
          y: shape.y,
          'font-size': shape.size ?? 9,
          'font-weight': 'bold',
          fill: shape.color ?? paper.ink,
          'text-anchor': 'middle',
          'font-family': 'Georgia, serif',
        }, shape.text);
      }
    }

    // halftone + grain for pulp texture
    el('rect', { x: 0, y: 0, width: 160, height: 90, fill: 'url(#cuttone)', opacity: 0.25 });
    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `<pattern id="cuttone" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.55" fill="#2b1d12"/></pattern>`;
    svg.insertBefore(defs, svg.firstChild);

    return svg;
  }

  function destroy() {
    finish();
  }

  return { play, destroy, get active() { return !!root; } };
}
