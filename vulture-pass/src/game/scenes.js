// Scene state machine (D2): TITLE → OVERWORLD ⇄ TOWN → COMBAT → CUTSCENE …
// Each registered scene owns enter/exit/update/render; one Three renderer
// draws whichever scene is current, DOM overlays ride above.

export function createSceneManager() {
  const scenes = new Map();
  let current = null;
  let currentName = null;

  return {
    register(name, scene) {
      scenes.set(name, scene);
    },
    async switchTo(name, params) {
      if (current?.exit) await current.exit(params);
      currentName = name;
      current = scenes.get(name) ?? null;
      if (current?.enter) await current.enter(params);
    },
    update(step) {
      current?.update?.(step);
    },
    render(dt, alpha) {
      current?.render?.(dt, alpha);
    },
    get name() {
      return currentName;
    },
    get current() {
      return current;
    },
  };
}
