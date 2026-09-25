// Tiny shared DOM helpers for per-screen builders (W1-UI).
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export const fmt = (n) => Math.floor(n).toLocaleString('en-US');
