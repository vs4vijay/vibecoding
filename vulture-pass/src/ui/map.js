// Overworld map (D4): sepia SVG screen — clickable towns, roads, day counter,
// boss-gated locked route, player marker. Sight upgrade gates ambush warnings
// (level 1) and distant-town prices (level 2) per spec.

import { region, towns, goods } from '../game/data/content.js';
import { paper } from '../game/data/palette.js';
import { combat as cbt } from '../game/data/tuning.js';
import { connectionsFor, planTrip } from '../game/travel.js';
import { townPrice, cargoValue, cargoCapacity, cargoUsed } from '../game/state.js';

export function createMapScreen({ state, actions }) {
  const root = document.createElement('div');
  root.id = 'map-screen';

  const header = document.createElement('div');
  header.className = 'map-header panel';
  header.innerHTML = `
    <div class="map-title">CHOLLA BASIN</div>
    <div class="map-stats">
      <span class="map-stat" id="map-day"></span>
      <span class="map-stat" id="map-money"></span>
      <span class="map-stat" id="map-cargo"></span>
      <span class="map-stat" id="map-points"></span>
    </div>
  `;
  root.appendChild(header);

  const wrap = document.createElement('div');
  wrap.className = 'map-wrap';
  root.appendChild(wrap);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'map-svg');
  wrap.appendChild(svg);

  const side = document.createElement('div');
  side.className = 'map-side panel';
  wrap.appendChild(side);

  // ------------------------------------------------------------ svg build
  const nodeEls = new Map();
  const routeEls = [];

  function el(name, attrs, parent = svg) {
    const e = document.createElementNS(svgNS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    return e;
  }

  // decorative sun + compass
  el('circle', { cx: 88, cy: 10, r: 5, fill: paper.accent, opacity: 0.65 });
  el('circle', { cx: 88, cy: 10, r: 7.5, fill: 'none', stroke: paper.accent, 'stroke-width': 0.3, opacity: 0.5 });
  const compass = el('g', { opacity: 0.55 });
  el('circle', { cx: 8, cy: 10, r: 4, fill: 'none', stroke: paper.line, 'stroke-width': 0.35 }, compass);
  el('path', { d: 'M8 6.6 L8.9 10 L8 13.4 L7.1 10 Z', fill: paper.line }, compass);
  el('text', { x: 8, y: 4.6, 'text-anchor': 'middle', 'font-size': 2.6, fill: paper.ink }, compass).textContent = 'N';

  // routes (curved, hand-drawn feel)
  for (const r of region.routes) {
    const a = region.nodes[r.a];
    const b = region.nodes[r.b];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const cx = mx + (-dy / len) * len * 0.12;
    const cy = my + (dx / len) * len * 0.12;
    const locked = r.gate === 'boss' && !state.bossDefeated;
    const path = el('path', {
      d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
      fill: 'none',
      stroke: locked ? paper.locked : paper.road,
      'stroke-width': locked ? 0.7 : 1.4,
      'stroke-linecap': 'round',
      'stroke-dasharray': locked ? '1.8 1.4' : 'none',
      opacity: locked ? 0.7 : 0.9,
    });
    const label = el('text', {
      x: cx,
      y: cy - 1,
      'text-anchor': 'middle',
      'font-size': 2.4,
      fill: locked ? paper.locked : paper.ink,
      opacity: 0.8,
    });
    label.textContent = locked ? `${r.road} (locked)` : r.road;
    routeEls.push({ r, path, label, locked });
  }

  // nodes
  for (const node of Object.values(region.nodes)) {
    const g = el('g', { class: `map-node kind-${node.kind}` });
    if (node.kind === 'town') {
      el('circle', { cx: node.x, cy: node.y, r: 2.6, fill: paper.town, stroke: paper.ink, 'stroke-width': 0.5 }, g);
      el('circle', { cx: node.x, cy: node.y, r: 0.9, fill: paper.ink }, g);
    } else if (node.kind === 'boss') {
      el('circle', { cx: node.x, cy: node.y, r: 2.4, fill: paper.ink, stroke: paper.accent, 'stroke-width': 0.5 }, g);
      // buzzard glyph: crude winged V
      el('path', { d: `M ${node.x - 1.6} ${node.y} L ${node.x} ${node.y + 0.9} L ${node.x + 1.6} ${node.y}`, fill: 'none', stroke: paper.accent, 'stroke-width': 0.45 }, g);
    } else {
      // gate (north pass)
      el('rect', { x: node.x - 2, y: node.y - 1.5, width: 4, height: 3, fill: 'none', stroke: paper.ink, 'stroke-width': 0.4, rx: 0.4 }, g);
      el('text', { x: node.x, y: node.y + 1, 'text-anchor': 'middle', 'font-size': 2.2, fill: paper.ink }, g).textContent = state.bossDefeated ? '⌂' : '🔒';
    }
    const name = el('text', {
      x: node.x,
      y: node.y + 4.6,
      'text-anchor': 'middle',
      'font-size': 3,
      'font-weight': 'bold',
      fill: paper.ink,
      class: 'map-node-name',
    }, g);
    name.textContent =
      node.kind === 'town'
        ? towns[node.id].name
        : node.kind === 'boss'
          ? "Buzzard's Roost"
          : state.bossDefeated
            ? 'North Pass'
            : 'North Pass 🔒';
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => selectNode(node.id));
    g.addEventListener('mouseenter', () => hoverNode(node.id));
    nodeEls.set(node.id, { g, node });
  }

  // player marker
  const marker = el('g', { class: 'map-marker' });
  el('circle', { cx: 0, cy: 0, r: 1.1, fill: paper.marker, stroke: paper.paper, 'stroke-width': 0.35 }, marker);
  el('path', { d: 'M0 -2.6 L0.8 -1.2 L-0.8 -1.2 Z', fill: paper.marker }, marker);
  svg.appendChild(marker);

  function placeMarker(nodeId) {
    const n = region.nodes[nodeId];
    if (!n) return;
    marker.style.transition = 'none';
    marker.setAttribute('transform', `translate(${n.x} ${n.y})`);
  }

  function animateMarker(toId, ms) {
    const n = region.nodes[toId];
    // reflow so the transition applies after the snap
    void svg.getBoundingClientRect().width;
    marker.style.transition = `transform ${ms}ms linear`;
    marker.setAttribute('transform', `translate(${n.x} ${n.y})`);
    return new Promise((res) => setTimeout(res, ms));
  }

  // ------------------------------------------------------------ side panel

  let selected = null;

  function sideDefault() {
    const at = state.location.townId ?? state.location.nodeId;
    const here = at ? region.nodes[at] : null;
    const points = state.points > 0 ? ` · <b>${state.points} upgrade point${state.points > 1 ? 's' : ''}!</b>` : '';
    side.innerHTML = `
      <div class="panel-title">Overworld</div>
      <p class="map-flavor">${here ? `You're camped at <b>${here.kind === 'town' ? towns[at].name : at}</b>.${points}` : 'On the road.'}</p>
      <p class="map-hint">Click a connected node to plan a trip.</p>
      <div class="map-actions">
        ${state.location.kind === 'town' ? '<button class="btn" id="map-enter">Enter town</button>' : ''}
        <button class="btn btn-ghost" id="map-upg">Upgrades${state.points > 0 ? ` (${state.points})` : ''}</button>
        <button class="btn btn-ghost" id="map-save">Save &amp; quit</button>
      </div>
    `;
    side.querySelector('#map-enter')?.addEventListener('click', () => actions.enterTown());
    side.querySelector('#map-upg')?.addEventListener('click', () => actions.openUpgrades());
    side.querySelector('#map-save')?.addEventListener('click', () => actions.saveQuit());
  }

  function priceTableHtml(townId) {
    const rows = Object.values(goods)
      .map((g) => {
        const p = townPrice(state, townId, g.id);
        const mine = state.cargo[g.id] ?? 0;
        return `<tr><td>${g.name}</td><td>$${p}</td><td>${mine || ''}</td></tr>`;
      })
      .join('');
    return `<table class="map-prices"><tr><th>good</th><th>price</th><th>held</th></tr>${rows}</table>`;
  }

  function hoverNode(nodeId) {
    const node = region.nodes[nodeId];
    if (node.kind !== 'town') return;
    if (state.upgrades.sight >= cbt.sightPriceLevel && nodeId !== state.location.townId) {
      // map sight level 2: distant-town price intel
      side.innerHTML = `
        <div class="panel-title">${towns[nodeId].name} — prices</div>
        <p class="map-flavor small">Scouted prices (map sight ${state.upgrades.sight}):</p>
        ${priceTableHtml(nodeId)}
        <div class="map-actions"><button class="btn btn-ghost" id="map-back">Back</button></div>
      `;
      side.querySelector('#map-back').addEventListener('click', () => {
        selected = null;
        sideDefault();
      });
    }
  }

  function selectNode(nodeId) {
    const node = region.nodes[nodeId];
    if (!node) return;
    selected = nodeId;
    const conn = connectionsFor(state.location.townId ?? state.location.nodeId);
    const reachable = conn.some((c) => c.to === nodeId);

    if (node.kind === 'town') {
      side.innerHTML = `
        <div class="panel-title">${towns[nodeId].name}</div>
        <p class="map-flavor small">${towns[nodeId].flavor}</p>
        ${reachable && state.upgrades.sight >= cbt.sightPriceLevel ? priceTableHtml(nodeId) : ''}
        <div class="map-actions" id="map-travel-actions"></div>
      `;
      const box = side.querySelector('#map-travel-actions');
      if (!reachable) {
        box.innerHTML = '<p class="map-hint">No direct road from here.</p>';
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'Plan trip';
        btn.addEventListener('click', () => planTripUi(nodeId));
        box.appendChild(btn);
      }
      const back = document.createElement('button');
      back.className = 'btn btn-ghost';
      back.textContent = 'Back';
      back.addEventListener('click', () => {
        selected = null;
        sideDefault();
      });
      box.appendChild(back);
    } else if (node.kind === 'boss') {
      side.innerHTML = `
        <div class="panel-title">Buzzard's Roost</div>
        <p class="map-flavor small">The Carrion Boys nest in the scrapyards north of the wire. Going there means the Buzzard himself.</p>
        <div class="map-actions" id="map-travel-actions"></div>
      `;
      const box = side.querySelector('#map-travel-actions');
      if (!reachable) box.innerHTML = '<p class="map-hint">No direct road from here.</p>';
      else {
        const btn = document.createElement('button');
        btn.className = 'btn btn-danger';
        btn.textContent = 'Ride on the Roost';
        btn.addEventListener('click', () => planTripUi(nodeId));
        box.appendChild(btn);
        const back = document.createElement('button');
        back.className = 'btn btn-ghost';
        back.textContent = 'Back';
        back.addEventListener('click', () => {
          selected = null;
          sideDefault();
        });
        box.appendChild(back);
      }
    } else {
      // north pass gate
      side.innerHTML = `
        <div class="panel-title">North Pass</div>
        <p class="map-flavor small">${
          state.bossDefeated
            ? 'The wire gate hangs open. The road north runs on past the edge of the map — the Basin keeps you for now.'
            : 'The Buzzard\'s toll gang locks the pass. Nobody rides north while he draws breath.'
        }</p>
        <div class="map-actions">${
          state.bossDefeated && reachable
            ? '<button class="btn" id="map-pass">Ride the pass</button>'
            : ''
        }<button class="btn btn-ghost" id="map-back">Back</button></div>
      `;
      side.querySelector('#map-pass')?.addEventListener('click', () => {
        side.innerHTML = `
          <div class="panel-title">North Pass</div>
          <p class="map-flavor small">You crest the pass at dusk. Beyond it: more desert, more roads, more trouble — another story. The Basin is yours; ride it as long as you like.</p>
          <div class="map-actions"><button class="btn btn-ghost" id="map-back">Back</button></div>
        `;
        side.querySelector('#map-back').addEventListener('click', () => {
          selected = null;
          sideDefault();
        });
      });
      side.querySelector('#map-back').addEventListener('click', () => {
        selected = null;
        sideDefault();
      });
    }
  }

  function planTripUi(toId) {
    const trip = planTrip(state, toId);
    if (!trip || trip.blocked) {
      side.innerHTML = `<div class="panel-title">Blocked</div><p class="map-flavor small">${trip?.reason ?? 'No road.'}</p>`;
      return;
    }
      const sight = state.upgrades.sight;
      const warn =
        sight >= cbt.sightWarnLevel
          ? trip.forcedBounty
            ? `<p class="map-warn">⚔ Bounty work: <b>${trip.forcedBounty}</b> waits on this road — a fight for sure.</p>`
            : trip.chance >= 0.45
              ? `<p class="map-warn">⚠ Map sight: bandits likely on this road (${Math.round(trip.chance * 100)}% risk).</p>`
              : `<p class="map-warn ok">Map sight: the road looks quiet (${Math.round(trip.chance * 100)}% risk).</p>`
          : '';
      side.innerHTML = `
        <div class="panel-title">Trip — ${trip.road}</div>
        <p class="map-flavor small">To <b>${region.nodes[toId].kind === 'town' ? towns[toId].name : region.nodes[toId].kind === 'boss' ? "Buzzard's Roost" : 'North Pass'}</b> · ${trip.days} day${trip.days > 1 ? 's' : ''}</p>
        <p class="map-flavor small">Hauling $${trip.cargoValue} of cargo.</p>
        ${warn}
        <div class="map-actions">
          <button class="btn" id="trip-go">Roll out</button>
          <button class="btn btn-ghost" id="trip-cancel">Cancel</button>
        </div>
      `;
      side.querySelector('#trip-go').addEventListener('click', () => actions.travel(toId));
      side.querySelector('#trip-cancel').addEventListener('click', () => {
        selected = null;
        sideDefault();
      });
  }

  // ------------------------------------------------------------ refresh

  function update() {
    const dayEl = root.querySelector('#map-day');
    if (dayEl) {
      dayEl.textContent = `Day ${state.day}`;
      root.querySelector('#map-money').textContent = `$${state.money}`;
      root.querySelector('#map-cargo').textContent = `Cargo ${cargoUsed(state)}/${cargoCapacity(state)} ($${cargoValue(state)})`;
      root.querySelector('#map-points').textContent = `Level ${state.level}${state.points ? ` · ${state.points} pts` : ''}`;
    }
    for (const { r, path, label } of routeEls) {
      const locked = r.gate === 'boss' && !state.bossDefeated;
      if (locked !== (path.getAttribute('data-locked') === 'true')) {
        path.setAttribute('data-locked', String(locked));
        path.setAttribute('stroke', locked ? paper.locked : paper.road);
        path.setAttribute('stroke-dasharray', locked ? '1.8 1.4' : 'none');
        label.textContent = locked ? `${r.road} (locked)` : r.road;
      }
    }
  }

  sideDefault();
  placeMarker(state.location.townId ?? state.location.nodeId ?? 'polvo');

  return { root, update, sideDefault, placeMarker, animateMarker, selectNode };
}
