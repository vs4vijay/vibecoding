// tests/ui/fake-dom.ts — minimal DOM fake for scene tests under Bun.
// Recursive element stubs: children, classList, style, textContent, listeners,
// dataset — everything the SceneManager and DOM-overlay scenes touch.

export class FakeElement {
  tagName: string;
  className = "";
  id = "";
  private ownText = "";
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  listeners = new Map<string, Array<(e?: unknown) => void>>();
  /** Canvas-ish geometry for the fake #game element. */
  width = 0;
  height = 0;

  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
  }

  /** Real-DOM semantics: reading textContent aggregates the subtree's text. */
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }

  set textContent(v: string) {
    this.ownText = v;
  }

  get classList(): {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    contains(name: string): boolean;
    toggle(name: string, force?: boolean): boolean;
  } {
    const self = this;
    const names = (): string[] => self.className.split(" ").filter((c) => c.length > 0);
    return {
      add(...added: string[]) {
        const set = new Set(names());
        for (const n of added) set.add(n);
        self.className = [...set].join(" ");
      },
      remove(...removed: string[]) {
        const gone = new Set(removed);
        self.className = names().filter((c) => !gone.has(c)).join(" ");
      },
      contains(name: string) {
        return names().includes(name);
      },
      toggle(name: string, force?: boolean) {
        const has = names().includes(name);
        const want = force ?? !has;
        if (want === has) return want;
        if (want) this.add(name);
        else this.remove(name);
        return want;
      },
    };
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...kids: FakeElement[]): void {
    for (const k of kids) this.appendChild(k);
  }

  removeChild(child: FakeElement): FakeElement {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
    return child;
  }

  remove(): void {
    if (this.parent !== null) this.parent.removeChild(this);
  }

  set innerHTML(html: string) {
    this.children = [];
    this.textContent = "";
    // Parse the tiny subset scenes use: plain text runs. Real markup isn't needed.
    const text = html.replace(/<[^>]*>/g, "");
    if (text.length > 0) this.textContent = text;
  }

  get innerHTML(): string {
    return this.textContent;
  }

  addEventListener(type: string, fn: (e?: unknown) => void): void {
    let list = this.listeners.get(type);
    if (list === undefined) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(fn);
  }

  removeEventListener(type: string, fn: (e?: unknown) => void): void {
    const list = this.listeners.get(type);
    if (list !== undefined) this.listeners.set(type, list.filter((f) => f !== fn));
  }

  dispatch(type: string, event?: unknown): void {
    const list = this.listeners.get(type);
    if (list !== undefined) for (const fn of [...list]) fn(event);
  }

  /** Depth-first querySelector by simple selector subset: "tag", "#id", ".class". */
  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  querySelectorAll(sel: string): FakeElement[] {
    const out: FakeElement[] = [];
    const visit = (el: FakeElement): void => {
      for (const c of el.children) {
        if (matches(c, sel)) out.push(c);
        visit(c);
      }
    };
    visit(this);
    return out;
  }
}

function matches(el: FakeElement, sel: string): boolean {
  if (sel.startsWith("#")) return el.id === sel.slice(1);
  if (sel.startsWith(".")) return el.classList.contains(sel.slice(1));
  return el.tagName === sel.toUpperCase();
}

/** keydown/keyup event shaped like KeyboardEvent (only `code` is read anywhere). */
export function fakeKey(code: string): { code: string; preventDefault(): void } {
  return { code, preventDefault() {} };
}

/** Document-level plumbing shared by all scenes under test. */
export function makeFakeDocument() {
  const doc = new FakeElement("#document");
  const ui = new FakeElement("div");
  ui.id = "ui";
  doc.appendChild(ui);
  (doc as unknown as { createElement(tag: string): FakeElement }).createElement =
    (tag: string) => new FakeElement(tag);
  return { doc, ui };
}
