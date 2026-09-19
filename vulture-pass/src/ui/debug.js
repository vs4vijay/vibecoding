// Debug panel (backtick toggles). Sections are fed by suppliers registered
// from wherever needs them — engine loop, input, scenes — so this file stays
// a dumb renderer.

export function createDebugPanel() {
  const el = document.createElement('div');
  el.id = 'debug-panel';
  document.getElementById('ui-root').appendChild(el);

  const suppliers = new Map(); // section name -> () => string
  let visible = false;

  function toggle() {
    visible = !visible;
    el.classList.toggle('visible', visible);
  }

  function onKey(e) {
    if (e.code === 'Backquote') {
      e.preventDefault();
      toggle();
    }
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  let frame = 0;
  function render() {
    frame++;
    if (!visible || frame % 10 !== 0) return;
    let html = '<span class="dbg-section">DEBUG ( ` to hide )</span>\n';
    for (const [name, fn] of suppliers) {
      html += `<span class="dbg-section">${name}</span>\n`;
      html += `<span class="dbg-kv">${fn()}</span>\n`;
    }
    el.innerHTML = html;
  }

  return {
    render,
    toggle,
    section(name, supplier) {
      suppliers.set(name, supplier);
    },
    get visible() {
      return visible;
    },
  };
}
