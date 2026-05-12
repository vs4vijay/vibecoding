# Building a lazygit / k9s-style TUI

A practical playbook for designing terminal UIs that *feel* like k9s and lazygit. Distilled from studying both tools and building real Ink + Bun apps.

Use this as a starting reference whenever you build a new TUI. It's opinionated and concrete — every pattern is something you can implement directly.

---

## 1. Pick your archetype

k9s and lazygit are both excellent TUIs but follow **different layouts**. Decide which one fits your domain before writing any code.

| Pattern | k9s | lazygit |
|---|---|---|
| **Primary layout** | Single big panel + header. Drill in/out pushes views onto a stack. | Multi-panel grid (5 panels) with one always-focused. |
| **Navigation** | `:` command mode is the *main* way to switch views. | Numbered keys `1`–`5` + Tab cycle. |
| **Best when** | You have many discrete resource types and one is in focus at a time. | You have a few panels that all matter and the user pivots between them. |
| **Focus indicator** | View name + breadcrumbs in header. | Bright border on focused panel; dim on others. |

**Hybrid is fine.** A common combo: lazygit-style multi-panel layout *inside each view* + k9s-style numbered top tabs *between views*. Mix when it helps.

---

## 2. The shell

Three regions, always in the same place, never relayout:

```
┌─ Header (1–2 lines) ──────────────────────────────────────────────┐
│ AppName · context (user/cluster/branch) · status · view tabs      │
└───────────────────────────────────────────────────────────────────┘
┌─ Body ────────────────────────────────────────────────────────────┐
│ Current view (varies). Panels live here.                          │
└───────────────────────────────────────────────────────────────────┘
[context-sensitive keys]  ·  [tab] cycle  [:] cmd  [?] help  [q] quit
```

Why fixed regions: users learn where to look once. Don't shift the header up when something errors, don't hide the footer when a modal opens.

**Header content priority** (left-to-right, drop the rightmost stuff as the terminal narrows):
1. App name + identity (who am I logged in as)
2. Current context (cluster / branch / project / namespace)
3. Live status numbers (e.g., quota remaining, # active jobs, request rate)
4. Numbered view tabs

**Footer content:** *only* the focused panel's keys + a short global tail (`tab`, `?`, `q`). Don't list every key you support — that's what `?` is for.

---

## 3. Focus model

Three good ways to express "where am I":

### a. Numbered tab jumps (`1`/`2`/`3`)
Instant. Beats Tab-cycling once you have 3+ views. Always available globally.

### b. Tab to cycle within a view
For sub-panels inside a view. `Tab` forward, `Shift+Tab` backward.

### c. Border color
- **Focused panel:** `cyan` (or `green` like lazygit)
- **Unfocused panel:** `gray` / dim
- **Selection inside a list:** `inverse` background (the row gets flipped)

```tsx
<Box borderColor={isFocused ? "cyan" : "gray"} borderStyle="round">
  ...
</Box>
```

That single property change is the cheapest, clearest focus signal in Ink.

### Selection vs focus
- **Focus** is *which panel* is taking keystrokes.
- **Selection** is *which row* inside a focused panel is highlighted.

Both have visual indicators. They're independent.

---

## 4. Within-panel navigation

Pick from this set; don't invent new keys.

| Key | Action |
|---|---|
| `j` / `↓` | Next row |
| `k` / `↑` | Previous row |
| `g` | Jump to top |
| `G` | Jump to bottom |
| `PgUp` / `PgDn` | Jump 10 rows |
| `Enter` / `l` | Drill in / expand / edit |
| `Esc` / `h` | Back / collapse |
| `/` | Filter (vim-style) |
| `x` | Remove / delete |
| `[` / `]` | Previous / next tab inside a panel |

Two more lazygit conventions worth stealing:
- **`Space`** to toggle multi-select state (e.g., stage/unstage, check/uncheck).
- **`a`** to apply to all (stage all, dismiss all).

---

## 5. Header / status bar

**k9s pattern:** the header is a *useful* place, not chrome. Top-left has cluster + namespace + user. Top-right is a grid of contextual keybindings — k9s puts hints there, not in a footer. CPU/memory metrics live in the header too.

**lazygit pattern:** the header is minimal (repo + branch). Hints all go to the footer.

**Default:** lazygit style — minimal header, footer for hints. Only adopt k9s's hint-grid-in-header if your header has a lot of unused horizontal real estate AND your views switch infrequently.

---

## 6. Footer / keybinding hints

**Rule: only show keys that work right now.** A footer that lists every key everywhere is just noise.

```tsx
// good: footer adapts to which panel has focus
const hints = focus === "list"
  ? [{ key: "j/k", label: "move" }, { key: "enter", label: "view" }]
  : [{ key: "esc", label: "back" }];
```

Always append a small global tail (`tab cycle · ? help · q quit`) so the user can find help even when they're lost.

**Format:**
```
[key] label   [key] label   [key] label   ·   [tab] cycle  [?] help  [q] quit
```
Colored `[key]` (cyan, bold) with dim label is the lazygit look. It's fast to scan.

---

## 7. Command palette (`:`)

The single best power-user feature. Implement it once, gives you free navigation forever.

**Triggers:** `:` (vim-style) or `Ctrl+K` (modern-app style). Either is fine; `:` is more terminal-native.

**Behavior:**
- Opens an overlay text input at the top or bottom of the screen
- Type a name, prefix-matches against registered commands
- Inline list shows up to ~6 matches with a hotkey on each
- `Enter` runs the top match (or exact name); `Esc` closes

**Commands to register:**
- Every view by name
- Every common action: `refresh`, `quit`, `help`, `logout`
- Power-user shortcuts: `:filter`, `:export`, `:sort`

**Aliases matter.** Let users type `:l` for a "list" view, `:n` for "new". Implement prefix-match against `name` AND `aliases[]`.

```ts
type Command = {
  name: string;          // canonical, e.g. "list"
  aliases?: string[];    // ["l", "2"]
  description: string;   // shown inline while typing
  action: () => void;
};
```

---

## 8. Help overlay (`?`)

Triggered by `?`. Either:
- **Centered modal** with a list of groups (lazygit). Closes on `Esc` or `?`.
- **Full-screen takeover** organized by category (k9s).

Either works. Group keys by **context** (Global, Current View, Current Panel), not by alphabet. Show the actual binding strings the user would press — `j/k`, not `<down>/<up>`.

Don't bother with help until you've got 15+ keys. Until then the contextual footer is enough.

---

## 9. Color conventions

These are the de facto standard across k9s, lazygit, ranger, fzf, vim, etc. Don't invent your own palette.

| Meaning | Color |
|---|---|
| Focus border | `cyan` or `green` |
| Unfocused border | `gray` (dim) |
| Selected row | `inverse` (flipped fg/bg) |
| Success / healthy / staged | `green` |
| Warning / pending / dirty | `yellow` |
| Error / unhealthy / rejected | `red` |
| Identity / refs / numbers | `cyan` |
| Highlight / current branch | `magenta` or `yellow` |
| Dim text / labels | `dim` |

**Don't use color as the only signal.** Color-blind users exist, and Windows Terminal still flubs some palettes. Pair color with shape: `▶ ` for selected, `[ ]` for tags, `⚠` for warnings.

---

## 10. Confirmation prompts

Two acceptable patterns:

**Inline at the bottom** (k9s):
```
Delete pod foo? [y/n] _
```
Lightweight, doesn't shift layout. Best for one-keystroke decisions.

**Centered modal** (lazygit):
```
┌─ Confirm ─────────────────┐
│ Delete pod foo?           │
│                           │
│  [ Confirm ]  [ Cancel ]  │
└───────────────────────────┘
```
Better for destructive actions (force-push, drop database). Forces the user to slow down.

For irreversible actions, require typing `y` (or the resource name) rather than accepting a single keypress. Friction prevents finger-mistakes.

---

## 11. Loading & error states

**Loading:** small spinner in a corner ("⟳ Refreshing…"). Don't replace the entire view — leave the existing data visible while you refresh. lazygit's pattern: bottom-right spinner; data stays put.

```tsx
const [frame, setFrame] = useState(0);
useEffect(() => {
  const t = setInterval(() => setFrame((f) => (f + 1) % 4), 120);
  return () => clearInterval(t);
}, []);
return <Text color="yellow">⟳ Refreshing{".".repeat(frame)}</Text>;
```

**Errors:**
- Transient (network blip): toast-like flash at the top or bottom, auto-dismiss.
- Persistent (auth failed, missing config): inline banner that stays until acknowledged.
- Fatal (can't load app data): a dedicated error view with `[r] retry  [q] quit`.

Never log errors to `stderr` while the TUI is mounted — they corrupt the layout. Capture and display in-app.

---

## 12. Forms / editing

This is where k9s and lazygit differ sharply.

**k9s:** presses `e`, shells out to `$EDITOR` with the resource YAML, runs `kubectl apply` on save. Zero in-app form code. Works because Kubernetes resources are *already* YAML.

**lazygit:** commit messages and rebase plans use *inline* forms inside the app, because there's no natural file-on-disk format.

**Rule:** if the data being edited has a natural text representation, shell out. If it's a structured field set with strict types/enums, build an inline form.

### Inline form pattern

A form is a column of rows. Each row is:
```
▶ Field label          current value          (←/→ cycle / press enter to edit)
```

- `↑/↓` moves between rows
- `Enter` on a text field: enters edit mode, opens an inline `<TextInput>`. `Enter` saves, `Esc` cancels.
- `←/→` cycles a select field through allowed values. (Avoids modal selector for short enum lists.)
- Long enum lists (>10): pop a dedicated picker overlay (or a cycle selector with a search field).

Don't build a "form panel that captures all keys" — make each row independently focusable, so global keys like `q`/`?` keep working when nothing is being edited.

---

## 13. Implementation in Ink — the must-knows

[Ink](https://github.com/vadimdemedes/ink) is React for the terminal. The patterns above translate cleanly, but several traps to know:

### Trap 1: `useInput` requires raw-mode TTY
If your process's stdin isn't a TTY (piped, redirected, CI), `useInput` throws on mount. There's no `isActive` flag that fully bypasses it — `setRawMode(true)` runs at hook init.

**Fix:** detect non-TTY at entry and bail with a clear message.
```ts
if (!process.stdin.isTTY) {
  console.error("This app requires an interactive terminal.");
  process.exit(2);
}
```

### Trap 2: Multiple `useInput` hooks all fire on the same key
There's no `stopPropagation`. If you have a parent and a child both listening, they BOTH receive the event.

**Fix:** use the `isActive` option (which DOES gate the *callback*, just not the raw-mode side effect) and only register the hook that should be active. Or render conditionally — if a modal is open, mount the modal's hook and not the parent's.

```tsx
useInput((input, key) => { /* ... */ }, { isActive: !modalOpen });
```

**Sub-trap — don't double-bind `Tab`.** Tempting to make Tab both *switch top-level tabs* (in the App shell) and *cycle panels* (inside a view). But because every active `useInput` fires on every key, both run on each Tab press — the App's view-switch wins and you see the wrong screen. The view's panel cycle did execute too, but you can't see it.

**Pick one role for Tab and stick to it.** lazygit / k9s both reserve Tab for *panel cycling within a view*. Use number keys (`1`/`2`/`3`) or a `:`-command for view switching. Single-purpose Tab keeps the model predictable.

```tsx
// In the App shell — DO NOT bind Tab.
// 1/2/3 switch views, : opens the command palette, that's it.
if (input === "1") setView("home");
else if (input === "2") setView("list");
else if (input === "3") setView("create");

// In each view, Tab is yours:
useInput((_, key) => { if (key.tab) cyclePanel(); }, { isActive });
```

### Trap 3: `ink-text-input` captures keys when `focus={true}`
The `focus` prop controls whether the internal `useInput` runs. Set it `false` when you want surrounding navigation keys to work and the input to be passive.

```tsx
<TextInput value={v} onChange={setV} onSubmit={onAdd} focus={panel === "input"} />
```

This is how you build a panel that has both a text input *and* navigable rows — flip `focus` based on which sub-mode is active.

### Trap 4: React keys
`<Box key={someId}>` — `someId` must actually be unique per row. Watch out for shared identifiers (parent IDs that get repeated across child rows, etc.). Test by rendering with strict React in dev to catch warnings.

### Trap 5: Multiple `<Text>` siblings in a row collapse trailing whitespace
Each `<Text>` in a row Box is rendered as an inline run. Trailing whitespace at the boundary between two siblings gets eaten — even if you `padEnd(10)`-ed it explicitly. Result: tabular layouts collide ("FooBar" instead of "Foo  Bar").

**Fix:** for tabular row layouts, use a *single* `<Text>` per row and concatenate fields with `.padEnd()` / `.padStart()` inside it. Nested `<Text>` within that one Text is fine for color/dim styling.

```tsx
// ❌ trailing spaces get eaten between siblings
<Box>
  <Text>{name.padEnd(20)}</Text>
  <Text dimColor>{type.padEnd(10)}</Text>
  <Text dimColor>{date}</Text>
</Box>

// ✅ one Text, spaces preserved
<Text>
  {name.padEnd(20)}
  <Text dimColor>{type.padEnd(10)}{date}</Text>
</Text>
```

### Trap 6: Equal-width rows need explicit flex basis
`flexDirection="row"` with `flexGrow={1}` on each child gives each child a share of the *remaining* space, not equal slices of the *parent's* space. Children with content occupy their content-width baseline first, then flex-grow distributes leftover. Result: ragged right edge where two side-by-side panels don't reach the same width as the row above.

**Fix:** set `flexBasis={0}` (or `width="50%"`) on each child along with `flexGrow={1}` — this forces equal slicing from the start. Pattern:

```tsx
<Box flexDirection="row" gap={1}>
  <Box flexBasis={0} flexGrow={1}>{leftPanel}</Box>
  <Box flexBasis={0} flexGrow={1}>{rightPanel}</Box>
</Box>
```

---

## 14. Reusable components

Build these once, use everywhere:

### `<FocusableList rows={...} columns={...} selectedIndex={i} viewportHeight={n} />`
- Renders a header row + N visible rows + scroll indicator
- Doesn't manage selection itself — parent owns `selectedIndex`
- Auto-scrolls so the selected row is in view
- Highlights selected row with `inverse`
- Columns are `{ header, width?, align?, render, color? }`

### `<CycleSelector items={...} selectedIndex={i} isFocused={b} render={fn} />`
- Single-line `◀ item ▶  (n/N)` widget
- Parent handles ←/→ to change selection
- Inverse styling when focused

### `<KeybindingBar contextHints={...} />`
- Renders the context-sensitive footer
- Hints are `{ key, label }[]`
- Appends a fixed global tail

### `<CommandPalette commands={...} onClose={...} />`
- The `:` overlay
- Prefix-matches name + aliases
- Inline match list with descriptions

### `<HelpOverlay groups={...} />`
- Modal with grouped keybindings
- Self-closes on `?` or `Esc`

These five components cover ~80% of a TUI. Build them in your `src/ui/components/` once and reuse.

---

## 15. State management

Keep state lazygit-flat, not k9s-nested. lazygit has a flat state model with explicit "current panel" + "current selection per panel" — easy to reason about. k9s has a view stack which is fine for resource navigation but overkill for most apps.

```ts
type AppState = {
  view: "home" | "list" | "create";         // top-level tabs
  focus: "left" | "right" | "form";          // panel within the current view
  refreshKey: number;                         // bumped to trigger reloads
  help: boolean;                              // help overlay open?
  palette: boolean;                           // command palette open?
  // ...view-specific state below
};
```

When something doesn't fit ("how do I model this overlay?"), prefer adding a dedicated state shape over reusing existing fields. State is cheap; bugs from overloaded state are expensive.

### Cross-remount data persistence

Switching views unmounts the inactive view's React tree. If that view's `useEffect` fetched data on mount, navigating away and back re-hits the network — and the user perceives an unexpected reload.

**Fix:** **lift data to the App shell.** Fetch once at startup, pass the data down as props. Each view becomes a pure renderer.

```ts
// App fetches data once
const [data, setData] = useState<{ items: Item[]; meta: Meta } | null>(null);

// Views receive props, no own fetch
<ListView items={data.items} ... />
```

Per-view local state (selection, scroll, pane focus) still resets on remount — that's fine, it's UI state. Data state should outlive remounts. Bump a `refreshKey` from the App on `r` to refetch on demand.

### Context hints leaking between views

If a view publishes its keybinding hints via a callback (`onContextHintsChange`), those hints stay in App state after the view unmounts. The next view inherits them until *it* publishes its own — leading to "[enter] add row" hints showing on a different view.

**Fix:** when the active view changes, clear hints in App. Each view re-publishes when it mounts.

```ts
useEffect(() => { setViewHints([]); }, [view]);
```

---

## 16. In-app login

Most TUIs eventually need credentials. Two ways to handle it.

### Don't: shell out to a prompt library *before* mounting Ink

It works, but: there's a visible "flash" between the prompt library's TTY raw-mode and Ink's, the layout shifts, and you can't recover from mid-session expiry without unmounting and re-prompting outside the React tree.

### Do: render an Ink login screen as a state of the App

Auth becomes a state in your shell:

```ts
type AuthState =
  | { kind: "checking" }                          // initial probe
  | { kind: "login"; reason: "first" | "expired" }
  | { kind: "ready"; client: ApiClient };
```

The login screen is just two `<TextInput>`s — username free, password with `mask="•"` for masking. Tab cycles fields, Enter submits. On success, transition to `ready`. On a session-expired error anywhere, transition back to `login` with `reason: "expired"` — no unmount, no console flash, in-place re-auth.

```tsx
<TextInput value={password} mask="•" focus={focused === "p" && !submitting}
  onChange={setPassword} onSubmit={() => void submit()} />
```

`mask="•"` is the standard password mask — every keystroke renders as the mask character regardless of what was typed. Combine with a `submitting` flag that disables both inputs so the user can't keep typing while the network call is in flight.

For propagating session-expired up from arbitrary views, use a tiny React Context that exposes `reportExpired()`. Any view that catches the error calls it; the shell switches to the login screen.

---

## 17. Building & distribution (Bun)

For Bun-based Ink apps, `bun build --compile` produces a single self-contained executable (~100–120 MB — the Bun runtime is bundled). Drop it on any machine, run it, no `npm install`.

```bash
bun build --compile --minify src/index.ts --outfile bin/myapp.exe
# cross-compile
bun build --compile --target=bun-linux-x64 --outfile bin/myapp-linux-x64 src/index.ts
```

### The one gotcha — Ink's devtools import

Ink has `if (process.env.DEV === 'true') await import('./devtools.js')` and `devtools.js` statically imports `react-devtools-core` — which isn't a real dependency. Bun's bundler follows the dynamic import even though the conditional is never true, then fails to resolve `react-devtools-core`.

`--external react-devtools-core` makes the build succeed but the binary then fails at startup ("Cannot find package…") because there's no `node_modules` at runtime in a compiled binary.

**Fix:** a 5-line Bun plugin that stubs the module with a no-op:

```ts
const stubDevtools: BunPlugin = {
  name: "stub-react-devtools",
  setup(b) {
    b.onResolve({ filter: /^react-devtools-core$/ }, (a) => ({
      path: a.path, namespace: "stub-devtools",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub-devtools" }, () => ({
      contents: "export default { connectToDevTools() {} };",
      loader: "js",
    }));
  },
};

await Bun.build({
  entrypoints: ["src/index.ts"],
  compile: { outfile: "bin/myapp.exe" },
  plugins: [stubDevtools],
  // ...
});
```

Use `Bun.build()` (the programmatic API) instead of the `bun build --compile` CLI when you need plugins. It supports all the same options.

### Single binary, two modes (dispatcher pattern)

If your app has both a TUI mode and CLI subcommands, a single binary with argv-based dispatch is cleaner than separate executables:

```ts
// src/index.ts
const args = process.argv.slice(2);
if (args.length > 0) {
  const { runCli } = await import("./cli.ts");   // CLI mode
  await runCli(args);
} else {
  if (!process.stdin.isTTY) { /* bail */ }
  const { App } = await import("./ui/app.tsx");   // TUI mode
  render(<App />);
}
```

The same `myapp.exe` becomes `myapp.exe` (TUI), `myapp.exe whoami` (CLI), `myapp.exe export file.csv` (subcommand). Don't ship N binaries when one will do.

---

## 18. Things to skip (anti-patterns)

- **Animations / transitions.** Terminal apps don't need fade-ins. They look broken.
- **Mouse support.** Some Ink components support it; don't bother. Keyboard-first is faster and works over SSH.
- **Toast notifications.** A bottom status line + a brief inline message is plenty. Toasts feel webby in a TUI.
- **Right-click menus / context menus.** That's what `x` or `e` keys are for.
- **Full-screen help on first launch.** Show a one-line hint instead ("Press `?` for keys").
- **Status bars with 12 sections.** Pick 3–5 that actually change.
- **Custom color schemes.** Stick to the standard palette above.
- **Heavy abstractions for sub-modes.** A `state.mode = "editing" | "navigating"` flag beats a state machine library for 95% of TUIs.

---

## 19. Concrete checklist for a new TUI

Copy this into your next project's PRD:

- [ ] Bun + Ink + `ink-text-input` (deps)
- [ ] `process.stdin.isTTY` guard at entry (only when launching the TUI)
- [ ] Single binary, argv dispatcher: no args → TUI, with args → CLI
- [ ] In-app login screen (Ink-based, `mask="•"` for password) — no shell-out
- [ ] Auth state machine: checking → login → ready, with `reportExpired()` context
- [ ] App shell: header (identity + numbered tabs) + body + footer
- [ ] KeybindingBar: context-sensitive footer; wipe on view change
- [ ] HelpOverlay: `?` shows grouped keys
- [ ] CommandPalette: `:` for view jumps and actions
- [ ] FocusableList: reusable selectable list
- [ ] CycleSelector: reusable single-line carousel
- [ ] Color palette: cyan/gray for borders, green/yellow/red for status
- [ ] Global keys: `1/2/3/?/:/r/q` (NOT `tab` — Tab is panel-scoped)
- [ ] Per-view: Tab cycles internal panels; numbered keys switch views
- [ ] Panel-focused border color: cyan focused, gray otherwise
- [ ] Selection: `inverse` on selected row
- [ ] Data fetched at App level once; views consume via props (no auto-refetch)
- [ ] Tabular rows use a single `<Text>` per row (not sibling Texts)
- [ ] Equal-split rows: `flexBasis={0} flexGrow={1}` on each child
- [ ] Loading state: small in-place spinner, don't blank the view
- [ ] Error state: inline banner + retry key
- [ ] Inline forms with row-level `↑/↓` + `Enter` to edit + `Esc` to cancel
- [ ] Confirmation: inline `[y/n]` for normal, modal for destructive
- [ ] `bun build --compile` with the `stub-react-devtools` plugin

---

## 20. The five highest-leverage patterns

If you only adopt five things, make it these. They're what separate a TUI that *feels* like lazygit/k9s from one that just runs in a terminal.

1. **Cyan border on focused panel, gray everywhere else.** One styling rule, immediate clarity.
2. **Numbered jumps for views, Tab for panels — never both.** `1`/`2`/`3` switches views; Tab cycles panels *within* the current view. Pick one role for Tab and commit to it; double-binding leads to the "I press Tab and lose my place" bug.
3. **Context-sensitive footer.** Show only the keys that work *now*, plus a short global tail. The single biggest UX win. Wipe on view change so nothing leaks.
4. **`:` command palette.** Replaces a menu bar, replaces a dozen niche keys, gives users a search-anywhere escape hatch.
5. **Inline editing with row-level focus.** Don't shell out for structured data, don't build a separate "edit screen" — make each form row independently focusable with `↑/↓` + `Enter`.

---

## References

- [k9s](https://github.com/derailed/k9s) — Kubernetes resource browser
- [lazygit](https://github.com/jesseduffield/lazygit) — Git terminal UI
- [Ink](https://github.com/vadimdemedes/ink) — React for CLIs
- [ink-text-input](https://github.com/vadimdemedes/ink-text-input) — single-line text input for Ink
- [ratatui](https://ratatui.rs/) — equivalent for Rust; same patterns apply
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) — equivalent for Go; same patterns apply
