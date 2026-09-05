/**
 * Shared UI DOM helpers — style injection and element builders.
 *
 * All CSS for menu/tutorial/wave/results/pause overlays is injected once
 * into <head> on first use. Plain DOM — no framework, no three/Rapier.
 */

let stylesInjected = false;

const UI_CSS = `
/* ---- overlay base ---- */
.lg-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  z-index: 10;
  font-family: system-ui, -apple-system, sans-serif;
  color: #eee;
}

/* ---- semi-transparent backdrop ---- */
.lg-backdrop {
  background: rgba(0, 0, 0, 0.72);
}

/* ---- menu ---- */
.lg-title {
  font-size: 3.5rem;
  font-weight: 900;
  letter-spacing: 0.15em;
  margin-bottom: 2rem;
  text-shadow: 0 2px 12px rgba(0,0,0,0.6);
}

.lg-menu-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.lg-btn {
  padding: 0.65rem 1.8rem;
  font-size: 1rem;
  font-weight: 600;
  border: 2px solid #7a9a4a;
  border-radius: 6px;
  background: #2a3a1a;
  color: #d8e8c0;
  cursor: pointer;
  outline: none;
  transition: background 0.15s, border-color 0.15s;
}
.lg-btn:hover, .lg-btn:focus-visible {
  background: #3a5a2a;
  border-color: #a0c860;
}
.lg-btn-active {
  background: #5a8a3a !important;
  border-color: #c0e870 !important;
  color: #fff;
}

.lg-radio-group {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 2rem;
}
.lg-radio-group label {
  padding: 0.4rem 1rem;
  border: 2px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  color: #aaa;
}
.lg-radio-group input[type="radio"] { display: none; }
.lg-radio-group input[type="radio"]:checked + span { color: #fff; font-weight: 600; }
.lg-radio-group label:has(input:checked) {
  border-color: #7a9a4a;
  background: #2a3a1a;
  color: #d8e8c0;
}

.lg-hint {
  position: absolute;
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.7);
  padding: 0.6rem 1.4rem;
  border-radius: 8px;
  font-size: 1rem;
  pointer-events: none;
  white-space: nowrap;
}

/* ---- wave banner ---- */
.lg-banner {
  position: absolute;
  top: 18%;
  left: 50%;
  transform: translateX(-50%);
  font-size: 2rem;
  font-weight: 700;
  text-shadow: 0 2px 10px rgba(0,0,0,0.7);
  pointer-events: none;
}

/* ---- results ---- */
.lg-results {
  text-align: center;
}
.lg-results h2 {
  font-size: 2rem;
  margin-bottom: 1rem;
}
.lg-results table {
  margin: 0 auto 1.2rem;
  border-collapse: collapse;
  font-size: 1rem;
}
.lg-results td {
  padding: 0.25rem 1rem;
  border-bottom: 1px solid #444;
}
.lg-results td:first-child {
  text-align: right;
  color: #aaa;
}
.lg-results td:last-child {
  text-align: left;
  font-weight: 600;
}
.lg-results .lg-score-total {
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}
.lg-results .lg-score-time {
  font-size: 1rem;
  color: #aaa;
  margin-bottom: 1rem;
}
.lg-results .lg-score-best {
  font-size: 0.9rem;
  color: #7a9a4a;
  margin-bottom: 1.5rem;
}

/* ---- death overlay ---- */
.lg-death {
  font-size: 2.4rem;
  font-weight: 800;
  color: #c44;
  text-shadow: 0 2px 12px rgba(0,0,0,0.6);
  margin-bottom: 1.5rem;
}

/* ---- pause overlay ---- */
.lg-pause-title {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
}
`;

/** Inject shared UI styles into <head> (idempotent). */
export function injectUIStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = UI_CSS;
  document.head.appendChild(style);
}

/** Create a DOM element with class and optional children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}
