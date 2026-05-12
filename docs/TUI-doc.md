# Building a lazygit / k9s-style TUI

A practical playbook for designing terminal apps that *feel* like k9s and lazygit. Distilled from studying both tools and building a real Ink + Bun TUI (`mediassist-tui` in this repo).

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

**Hybrid is fine.** mediassist-tui uses lazygit-style panels inside each view and k9s-style numbered top tabs to switch between views. Mix when it helps.

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
2. Current context (cluster / branch / policy number)
3. Live status numbers (sum insured remaining, # pods running)
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
- **`Space`** to toggle multi-select state (e.g., stage/unstage).
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
- Every view: `dashboard`, `claims`, `new`, `settings`
- Every common action: `refresh`, `quit`, `help`, `logout`
- Power-user shortcuts: `:filter`, `:export`

**Aliases matter.** Let users type `:c` for claims, `:d` for dashboard. Implement prefix-match against `name` AND `aliases[]`.

```ts
type Command = {
  name: string;          // canonical: "claims"
  aliases?: string[];    // ["c", "2"]
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

For irreversible things (e.g., submitting a real claim — *don't do this without explicit user approval, per `feedback_mediassist_no_submit.md`*), require typing `y` not just pressing `y`. Friction prevents finger-mistakes.

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

**Rule:** if the data being edited has a natural text representation, shell out. If it's a structured field set (e.g., extracted invoice data), build an inline form.

### Inline form pattern (the one I built)

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

[Ink](https://github.com/vadimdemedes/ink) is React for the terminal. The patterns above translate cleanly, but four traps to know:

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

### Trap 3: `ink-text-input` captures keys when `focus={true}`
The `focus` prop controls whether the internal `useInput` runs. Set it `false` when you want surrounding navigation keys to work and the input to be passive.

```tsx
<TextInput value={v} onChange={setV} onSubmit={onAdd} focus={panel === "input"} />
```

This is how you build a panel that has both a text input *and* navigable rows — flip `focus` based on which sub-mode is active.

### Trap 4: React keys
`<Box key={someId}>` — `someId` must actually be unique per row. Watch out for shared IDs (e.g., a primary-key field that's repeated across family members). Test by rendering with strict React in dev to catch warnings.

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
  view: "dashboard" | "claims" | "newClaim";   // tabs
  focus: "files" | "edit" | "beneficiary";     // panel within current view
  refreshKey: number;                           // bumped to trigger reloads
  help: boolean;                                // help overlay
  palette: boolean;                             // command palette
  // ...view-specific state below
};
```

When something doesn't fit ("how do I model the dry-run overlay?"), prefer adding a dedicated state shape over reusing existing fields. State is cheap; bugs from overloaded state are expensive.

---

## 16. Things to skip (anti-patterns)

- **Animations / transitions.** Terminal apps don't need fade-ins. They look broken.
- **Mouse support.** Some Ink components support it; don't bother. Keyboard-first is faster and works over SSH.
- **Toast notifications.** A bottom status line + a brief inline message is plenty. Toasts feel webby in a TUI.
- **Right-click menus / context menus.** That's what `x` or `e` keys are for.
- **Full-screen help on first launch.** Show a one-line hint instead ("Press `?` for keys").
- **Status bars with 12 sections.** Pick 3–5 that actually change.
- **Custom color schemes.** Stick to the standard palette above.
- **Heavy abstractions for sub-modes.** A `state.mode = "editing" | "navigating"` flag beats a state machine library for 95% of TUIs.

---

## 17. Concrete checklist for a new TUI

Copy this into your next project's PRD:

- [ ] Bun + Ink + `ink-text-input` (deps)
- [ ] `process.stdin.isTTY` guard at entry
- [ ] Header component: app name + identity + numbered tabs
- [ ] KeybindingBar: context-sensitive footer
- [ ] HelpOverlay: `?` shows grouped keys
- [ ] CommandPalette: `:` for view jumps and actions
- [ ] FocusableList: reusable selectable list
- [ ] CycleSelector: reusable single-line carousel
- [ ] Color palette: cyan/gray for borders, green/yellow/red for status
- [ ] Global keys: `1/2/3/tab/?/:/r/q`
- [ ] Panel-focused border color: cyan focused, gray otherwise
- [ ] Selection: `inverse` on selected row
- [ ] Loading state: small in-place spinner, don't blank the view
- [ ] Error state: inline banner + retry key
- [ ] Inline forms with row-level `↑/↓` + `Enter` to edit + `Esc` to cancel
- [ ] Confirmation: inline `[y/n]` for normal, modal for destructive

---

## 18. The five highest-leverage patterns

If you only adopt five things, make it these. They're what separate a TUI that *feels* like lazygit/k9s from one that just runs in a terminal.

1. **Cyan border on focused panel, gray everywhere else.** One styling rule, immediate clarity.
2. **Numbered tab jumps + Tab fallback.** `1`/`2`/`3` for views, Tab for sub-panels. Power users never use a mouse.
3. **Context-sensitive footer.** Show only the keys that work *now*, plus a 4-key global tail. The single biggest UX win.
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
