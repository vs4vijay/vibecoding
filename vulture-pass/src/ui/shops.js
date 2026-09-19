// Shop interfaces (6.2–6.5, 7.2): trade market, garage, gun shop, job board,
// plus the upgrade-tracks panel. All DOM overlays; every mutation goes
// through state.js intents and renders the returned result/refusal.

import { goods, towns, cars, weapons } from '../game/data/content.js';
import { townPrice, cargoUsed, cargoCapacity, cargoValue, repairFee, buyGood, sellGood, repairCar, buyCar, buyWeapon, assignMount, buyInsurance, spendPoint, reloadTime } from '../game/state.js';
import { generateBoard, acceptJob, abandonJob } from '../game/jobs.js';
import { economy as eco } from '../game/data/tuning.js';
import { sfxUi } from './sfx.js';

export function createShopManager({ state, onClose }) {
  let root = null;
  let current = null;
  let board = null; // job board for the current town visit
  let boardTown = null;
  let toastTimer = null;

  function open(kind, townId) {
    close();
    root = document.createElement('div');
    root.className = 'shop-root';
    document.getElementById('ui-root').appendChild(root);
    current = { kind, townId };
    if (kind === 'trade') renderTrade();
    else if (kind === 'garage') renderGarage();
    else if (kind === 'gun') renderGun();
    else if (kind === 'jobs') renderJobs();
    sfxUi('open');
  }

  function close() {
    root?.remove();
    root = null;
    current = null;
    onClose?.();
  }

  function frame(title, bodyHtml) {
    root.innerHTML = `
      <div class="shop-panel panel">
        <div class="shop-head">
          <div class="panel-title">${title}</div>
          <div class="shop-wallet">$${state.money}</div>
          <button class="btn btn-ghost shop-close" id="shop-close">Leave ✕</button>
        </div>
        <div class="shop-body">${bodyHtml}</div>
      </div>
    `;
    root.querySelector('#shop-close').addEventListener('click', () => {
      sfxUi('click');
      close();
    });
  }

  function toast(msg, ok = true) {
    let t = root.querySelector('.shop-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'shop-toast';
      root.querySelector('.shop-panel').appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('bad', !ok);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t?.remove(), 2600);
    sfxUi(ok ? 'cash' : 'deny');
  }

  function run(intentFn, okMsg) {
    const res = intentFn();
    if (res.ok) {
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(res) : okMsg, true);
    } else if (res.reason) {
      toast(res.reason, false);
    }
    return res;
  }

  // ------------------------------------------------------------ 6.2 trade

  function renderTrade() {
    const townId = current.townId;
    const rows = Object.values(goods)
      .map((g) => {
        const price = townPrice(state, townId, g.id);
        const held = state.cargo[g.id] ?? 0;
        return `
          <tr data-good="${g.id}">
            <td class="good-name">${g.name}</td>
            <td class="good-price">$${price}</td>
            <td class="good-held">${held || '—'}</td>
            <td>
              <button class="btn btn-small" data-buy="${g.id}">Buy</button>
            </td>
            <td>
              <button class="btn btn-small btn-ghost" data-sell="${g.id}" ${held ? '' : 'disabled'}>Sell</button>
            </td>
          </tr>`;
      })
      .join('');
    frame(
      `${towns[townId].name} — Market`,
      `
      <div class="shop-sub">Cargo: <b>${cargoUsed(state)}/${cargoCapacity(state)}</b> · haul value $${cargoValue(state)}</div>
      <table class="shop-table">
        <tr><th>good</th><th>price</th><th>held</th><th></th><th></th></tr>
        ${rows}
      </table>
      <div class="shop-note">Prices drift daily. Buy where cheap, sell where dear — and watch the roads.</div>
    `
    );
    for (const btn of root.querySelectorAll('[data-buy]')) {
      btn.addEventListener('click', () => {
        const goodId = btn.dataset.buy;
        const space = cargoCapacity(state) - cargoUsed(state);
        const affordable = Math.floor(state.money / townPrice(state, townId, goodId));
        const qty = Math.max(1, Math.min(5, space, affordable));
        run(() => buyGood(state, townId, goodId, qty), `Bought ${qty} ${goods[goodId].name}`);
        renderTrade();
      });
    }
    for (const btn of root.querySelectorAll('[data-sell]')) {
      btn.addEventListener('click', () => {
        const goodId = btn.dataset.sell;
        const qty = state.cargo[goodId] ?? 0;
        run(() => sellGood(state, townId, goodId, qty), `Sold ${qty} ${goods[goodId].name}`);
        renderTrade();
      });
    }
  }

  // ------------------------------------------------------------ 6.3 garage

  function renderGarage() {
    const car = cars[state.carId];
    const fee = repairFee(state);
    const rows = Object.values(cars)
      .map((c) => {
        const mine = c.id === state.carId;
        const shrink = cargoUsed(state) > c.cargo;
        return `
          <tr class="${mine ? 'mine' : ''}">
            <td class="good-name">${c.name}${mine ? ' <span class="tag">yours</span>' : ''}</td>
            <td>❤ ${c.maxHealth}</td>
            <td>⚡ ${c.topSpeed}</td>
            <td>📦 ${c.cargo}</td>
            <td class="good-price">$${c.price}</td>
            <td>${mine ? '' : `<button class="btn btn-small" data-car="${c.id}">Buy${shrink ? ' ⚠' : ''}</button>`}</td>
          </tr>`;
      })
      .join('');
    frame(
      'Garage',
      `
      <div class="shop-sub">Driving: <b>${car.name}</b> · hull ${Math.round(state.carHealth)}/${car.maxHealth}</div>
      <div class="shop-actions-row">
        <button class="btn" id="garage-repair" ${fee === 0 ? 'disabled' : ''}>Repair — $${fee}</button>
        <button class="btn ${state.insurance ? 'btn-ghost' : ''}" id="garage-ins" ${state.insurance ? 'disabled' : ''}>${state.insurance ? 'Insured ✓' : `Insurance — $${eco.insurancePrice}`}</button>
      </div>
      <table class="shop-table">
        <tr><th>car</th><th>armor</th><th>speed</th><th>cargo</th><th>price</th><th></th></tr>
        ${rows}
      </table>
      <div class="shop-note">⚠ = your cargo overflows that car's bed; buying drops the excess (job cargo fails).</div>
    `
    );
    root.querySelector('#garage-repair')?.addEventListener('click', (e) => {
      run(() => repairCar(state), (r) => `Repaired for $${r.fee}`);
      renderGarage();
    });
    root.querySelector('#garage-ins')?.addEventListener('click', () => {
      run(() => buyInsurance(state), 'Insured — next defeat waives the money loss');
      renderGarage();
    });
    for (const btn of root.querySelectorAll('[data-car]')) {
      btn.addEventListener('click', () => {
        const carId = btn.dataset.car;
        const target = cars[carId];
        const wouldDrop = cargoUsed(state) > target.cargo;
        if (wouldDrop && !btn.dataset.confirmed) {
          btn.dataset.confirmed = '1';
          btn.textContent = 'Lose cargo?';
          toast(`Cargo overflows: carrying ${cargoUsed(state)}, ${target.name} holds ${target.cargo}. Click again to lose the excess.`, false);
          return;
        }
        run(
          () => buyCar(state, carId, { dropExcess: true }),
          (r) => `Bought ${target.name}${r.dropped ? ` — dropped ${r.dropped} cargo` : ''}`
        );
        renderGarage();
      });
    }
  }

  // ------------------------------------------------------------ 6.4 gun shop

  function renderGun() {
    const rows = Object.values(weapons)
      .map((w) => {
        const owned = state.ownedWeapons.includes(w.id);
        const onL = state.mounts.left === w.id;
        const onR = state.mounts.right === w.id;
        return `
          <tr class="${onL || onR ? 'mine' : ''}">
            <td class="good-name">${w.name}${onL ? ' <span class="tag">L</span>' : ''}${onR ? ' <span class="tag">R</span>' : ''}</td>
            <td class="w-desc">${w.flavor}</td>
            <td>${w.kind === 'hitscan' ? `${w.pellets}×${w.damage}` : w.kind === 'burst' ? `${w.burst}×${w.damage}` : `${w.damage}+splash`}</td>
            <td>${w.reload.toFixed(1)}s</td>
            <td class="good-price">${owned ? 'owned' : `$${w.price}`}</td>
            <td>
              ${owned ? '' : `<button class="btn btn-small" data-buyw="${w.id}">Buy</button>`}
              <button class="btn btn-small btn-ghost" data-mount="${w.id}" data-side="left" ${owned ? '' : 'disabled'}>→ L</button>
              <button class="btn btn-small btn-ghost" data-mount="${w.id}" data-side="right" ${owned ? '' : 'disabled'}>→ R</button>
            </td>
          </tr>`;
      })
      .join('');
    frame(
      'Gun Shop',
      `
      <div class="shop-sub">Left mount: <b>${state.mounts.left ?? '—'}</b> · Right mount: <b>${state.mounts.right ?? '—'}</b></div>
      <table class="shop-table">
        <tr><th>weapon</th><th></th><th>dmg</th><th>cycle</th><th></th><th></th></tr>
        ${rows}
      </table>
      <div class="shop-note">Aim left of the hood to fire the left gun, right for the right. Ammo's free; hulls aren't.</div>
    `
    );
    for (const btn of root.querySelectorAll('[data-buyw]')) {
      btn.addEventListener('click', () => {
        run(() => buyWeapon(state, btn.dataset.buyw), 'Bought');
        renderGun();
      });
    }
    for (const btn of root.querySelectorAll('[data-mount]')) {
      btn.addEventListener('click', () => {
        const wid = btn.dataset.mount;
        const side = btn.dataset.side;
        // buying + assigning in one gesture if not owned
        if (!state.ownedWeapons.includes(wid)) {
          const res = buyWeapon(state, wid);
          if (!res.ok) {
            toast(res.reason, false);
            return;
          }
        }
        run(() => assignMount(state, wid, side), (r) => `Mounted ${side} (was ${r.replaced ?? 'empty'})`);
        renderGun();
      });
    }
  }

  // ------------------------------------------------------------ 6.5 jobs

  function renderJobs() {
    const townId = current.townId;
    if (boardTown !== townId || !board) {
      board = generateBoard(state, townId).filter(
        (j) => !state.jobs.active.some((a) => a.id === j.id)
      );
      boardTown = townId;
    }
    const activeHtml = state.jobs.active
      .map(
        (j) => `
        <div class="job-card">
          <b>${j.kind === 'delivery' ? `${j.units}× ${goods[j.goodId].name} → ${towns[j.toTown].name}` : `Bounty: ${j.name}`}</b>
          <span class="job-reward">$${j.reward}</span>
          <button class="btn btn-small btn-danger" data-abandon="${j.id}">Drop</button>
        </div>`
      )
      .join('');
    const boardHtml = board
      .map(
        (j) => `
        <div class="job-card">
          <b>${j.kind === 'delivery' ? `${j.units}× ${goods[j.goodId].name} → ${towns[j.toTown].name}` : `Bounty: ${j.name} <span class="tag">(${j.archetype})</span>`}</b>
          <span class="job-reward">$${j.reward}</span>
          <button class="btn btn-small" data-take="${j.id}">Take</button>
        </div>`
      )
      .join('');
    frame(
      'Job Board',
      `
      <div class="shop-sub">On the books: ${state.jobs.active.length}/3 · done ${state.jobs.completed} · failed ${state.jobs.failed}</div>
      ${activeHtml || '<div class="shop-note">Nothing on the books.</div>'}
      <div class="panel-title" style="margin-top:14px">Open work</div>
      ${boardHtml || '<div class="shop-note">Board is bare. Check back in a few days.</div>'}
      <div class="shop-note">Deliveries ride in your bed — lose the cargo, lose the job. Bounties ambush you on the next run out.</div>
    `
    );
    for (const btn of root.querySelectorAll('[data-take]')) {
      btn.addEventListener('click', () => {
        const job = board.find((j) => j.id === btn.dataset.take);
        const res = run(() => acceptJob(state, job), 'Job taken');
        if (res.ok) board = board.filter((j) => j !== job);
        renderJobs();
      });
    }
    for (const btn of root.querySelectorAll('[data-abandon]')) {
      btn.addEventListener('click', () => {
        run(() => abandonJob(state, btn.dataset.abandon), 'Dropped');
        renderJobs();
      });
    }
  }

  function isOpen() {
    return !!root;
  }

  return { open, close, isOpen, get current() { return current; } };
}

// ------------------------------------------------------------ 7.2 upgrades panel

export function createUpgradesPanel({ state, onClose }) {
  let root = null;

  const tracks = [
    { id: 'reload', name: 'Gun Hand', desc: '−12% reload per rank, both mounts', effect: (lv) => `reload ×${Math.pow(0.88, lv).toFixed(2)}` },
    { id: 'repair', name: 'Tinkerer', desc: 'after each won fight: heal 16% max hull per rank', effect: (lv) => `+${Math.round(lv * 16)}% hull on victory` },
    { id: 'sight', name: 'Map Sight', desc: 'rank 1: ambush warnings · rank 2: distant prices', effect: (lv) => `sight rank ${lv}/2` },
  ];

  function open() {
    close();
    root = document.createElement('div');
    root.className = 'shop-root';
    document.getElementById('ui-root').appendChild(root);
    render();
  }

  function render() {
    const rows = tracks
      .map(
        (t) => `
        <div class="upg-card">
          <div class="upg-name">${t.name} <span class="tag">rank ${state.upgrades[t.id]}</span></div>
          <div class="upg-desc">${t.desc}</div>
          <div class="upg-effect">now: ${t.effect(state.upgrades[t.id])}</div>
          <button class="btn btn-small" data-track="${t.id}" ${state.points > 0 ? '' : 'disabled'}>Spend point</button>
        </div>`
      )
      .join('');
    root.innerHTML = `
      <div class="shop-panel panel">
        <div class="shop-head">
          <div class="panel-title">Upgrades — ${state.points} point${state.points === 1 ? '' : 's'}</div>
          <button class="btn btn-ghost shop-close" id="upg-close">Done ✕</button>
        </div>
        <div class="shop-body"><div class="upg-grid">${rows}</div>
        <div class="shop-note">Level up by winning fights and collecting bounties. Ranks stack with better guns and cars.</div></div>
      </div>
    `;
    root.querySelector('#upg-close').addEventListener('click', close);
    for (const btn of root.querySelectorAll('[data-track]')) {
      btn.addEventListener('click', () => {
        const res = spendPoint(state, btn.dataset.track);
        if (res.ok) sfxUi('click');
        render();
      });
    }
  }

  function close() {
    root?.remove();
    root = null;
    onClose?.();
  }

  return { open, close };
}
