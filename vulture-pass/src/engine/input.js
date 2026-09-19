// Input module: keyboard state + mouse aim (2.2).
//
// Key events accumulate into `justPressed` between animation frames; the game
// reads them during sim steps and calls endFrame() from its render callback so
// each press is seen by at most one frame's worth of steps.

const GAME_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyE',
  'KeyQ',
  'Escape',
  'Enter',
]);

export function createInput() {
  const down = new Set();
  const justPressed = new Set();
  const mouse = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    down: false,
    // world-space aim on the ground plane; filled in by the active scene
    worldX: 0,
    worldZ: 0,
    hasWorld: false,
  };

  function onKeyDown(e) {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) justPressed.add(e.code);
    down.add(e.code);
  }
  function onKeyUp(e) {
    down.delete(e.code);
  }
  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }
  function onMouseDown(e) {
    if (e.button === 0) mouse.down = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) mouse.down = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', () => {
    down.clear();
    mouse.down = false;
  });

  return {
    isDown(code) {
      return down.has(code);
    },
    wasPressed(code) {
      return justPressed.has(code);
    },
    anyPressed() {
      return justPressed.size > 0;
    },
    pressedList() {
      return [...justPressed];
    },
    downList() {
      return [...down];
    },
    mouse,
    // Called once per rendered frame; presses belong to the frame they arrived in.
    endFrame() {
      justPressed.clear();
    },
  };
}

// Driving-style axes from either WASD or arrows. Returns { throttle, brake, steer } in [-1, 1].
export function readDrivingAxes(input) {
  const throttle =
    (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0) -
    (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0);
  const steer =
    (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0) -
    (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0);
  return { throttle, steer };
}
