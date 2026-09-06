import type { EntityState, InputState, PlayerState, Vec3 } from '@dustline/shared';
import {
  PLAYER_GRAVITY,
  PLAYER_HEIGHT,
  PLAYER_JUMP_FORCE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_WALK_SPEED,
  TICK_INTERVAL_MS,
} from '@dustline/shared';

/**
 * The locally predicted part of the player state. Rotation is deliberately
 * excluded: view angles are applied client-side the moment the mouse moves
 * and are carried to the server inside each input.
 */
export interface LocalSimState {
  position: Vec3;
  velocity: Vec3;
  onGround: boolean;
}

/** Fixed timestep per input, matching the server's per-input simulation step. */
export const SIMULATION_DT = TICK_INTERVAL_MS / 1000;

/**
 * Project a snapshot player state into the predicted-state shape. `onGround`
 * is not part of the wire format, so it is inferred: the server zeroes
 * vertical velocity exactly when the player comes to rest on the ground.
 */
export function extractLocalState(player: PlayerState): LocalSimState {
  return {
    position: { ...player.position },
    velocity: { ...player.velocity },
    onGround: player.velocity.y === 0,
  };
}

/**
 * Apply one input to the local simulation state. This mirrors the server's
 * `processPlayerInput` (packages/server/src/game/player.ts) including its
 * axis-separated collision resolution (below), so prediction stays in step
 * with the authoritative simulation and corrections stay rare. Keep in sync
 * with the server code.
 */
export function applyLocalInput(
  state: LocalSimState,
  input: InputState,
  entities: EntityState[],
  dt: number = SIMULATION_DT,
): LocalSimState {
  // Calculate movement direction from the input's view angles
  const speed = input.walk ? PLAYER_WALK_SPEED : PLAYER_SPEED;
  const yaw = input.yaw;
  let moveX = 0;
  let moveZ = 0;

  if (input.forward) {
    moveX += Math.sin(yaw) * speed;
    moveZ += Math.cos(yaw) * speed;
  }
  if (input.backward) {
    moveX -= Math.sin(yaw) * speed;
    moveZ -= Math.cos(yaw) * speed;
  }
  if (input.left) {
    moveX += Math.sin(yaw - Math.PI / 2) * speed;
    moveZ += Math.cos(yaw - Math.PI / 2) * speed;
  }
  if (input.right) {
    moveX += Math.sin(yaw + Math.PI / 2) * speed;
    moveZ += Math.cos(yaw + Math.PI / 2) * speed;
  }

  // Normalize diagonal movement
  if (moveX !== 0 || moveZ !== 0) {
    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (len > speed) {
      moveX = (moveX / len) * speed;
      moveZ = (moveZ / len) * speed;
    }
  }

  let velocity: Vec3 = { x: moveX, y: state.velocity.y, z: moveZ };
  let onGround = state.onGround;

  // Jump
  if (input.jump && onGround) {
    velocity.y = PLAYER_JUMP_FORCE;
    onGround = false;
  }

  // Gravity
  if (!onGround) {
    velocity.y -= PLAYER_GRAVITY * dt;
  }

  // Apply physics and collision
  const resolved = resolveLocalCollision(state.position, velocity, entities, dt);
  const position = resolved.position;
  velocity = resolved.velocity;
  onGround = resolved.onGround;

  // Keep player above ground minimum
  if (position.y < PLAYER_HEIGHT / 2) {
    position.y = PLAYER_HEIGHT / 2;
    velocity.y = 0;
    onGround = true;
  }

  return { position, velocity, onGround };
}

interface AABB {
  min: Vec3;
  max: Vec3;
}

function entityToAABB(entity: EntityState): AABB {
  const halfX = entity.size.x / 2;
  const halfY = entity.size.y / 2;
  const halfZ = entity.size.z / 2;
  return {
    min: {
      x: entity.position.x - halfX,
      y: entity.position.y - halfY,
      z: entity.position.z - halfZ,
    },
    max: {
      x: entity.position.x + halfX,
      y: entity.position.y + halfY,
      z: entity.position.z + halfZ,
    },
  };
}

function playerToAABB(position: Vec3): AABB {
  return {
    min: {
      x: position.x - PLAYER_RADIUS,
      y: position.y - PLAYER_HEIGHT / 2,
      z: position.z - PLAYER_RADIUS,
    },
    max: {
      x: position.x + PLAYER_RADIUS,
      y: position.y + PLAYER_HEIGHT / 2,
      z: position.z + PLAYER_RADIUS,
    },
  };
}

function intersectAABB(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

/**
 * Copy of the server's `resolvePlayerCollision`
 * (packages/server/src/game/collision.ts). Prediction must integrate
 * movement exactly like the server or every contact produces corrections.
 * Keep in sync with the server code.
 */
function resolveLocalCollision(
  position: Vec3,
  velocity: Vec3,
  entities: EntityState[],
  dt: number,
): { position: Vec3; velocity: Vec3; onGround: boolean } {
  let onGround = false;

  // Try to move along each axis separately
  const newPos = { ...position };
  const newVel = { ...velocity };

  // X axis
  newPos.x += velocity.x * dt;
  const playerAABBX = playerToAABB(newPos);
  for (const entity of entities) {
    const entityAABB = entityToAABB(entity);
    if (intersectAABB(playerAABBX, entityAABB)) {
      if (velocity.x > 0) {
        newPos.x = entityAABB.min.x - PLAYER_RADIUS - 0.01;
      } else if (velocity.x < 0) {
        newPos.x = entityAABB.max.x + PLAYER_RADIUS + 0.01;
      }
      newVel.x = 0;
      break;
    }
  }

  // Z axis
  newPos.z += velocity.z * dt;
  const playerAABBZ = playerToAABB(newPos);
  for (const entity of entities) {
    const entityAABB = entityToAABB(entity);
    if (intersectAABB(playerAABBZ, entityAABB)) {
      if (velocity.z > 0) {
        newPos.z = entityAABB.min.z - PLAYER_RADIUS - 0.01;
      } else if (velocity.z < 0) {
        newPos.z = entityAABB.max.z + PLAYER_RADIUS + 0.01;
      }
      newVel.z = 0;
      break;
    }
  }

  // Y axis
  newPos.y += velocity.y * dt;
  const playerAABBY = playerToAABB(newPos);
  for (const entity of entities) {
    const entityAABB = entityToAABB(entity);
    if (intersectAABB(playerAABBY, entityAABB)) {
      if (velocity.y > 0) {
        newPos.y = entityAABB.min.y - PLAYER_HEIGHT / 2 - 0.01;
      } else if (velocity.y < 0) {
        newPos.y = entityAABB.max.y + PLAYER_HEIGHT / 2 + 0.01;
        onGround = true;
      }
      newVel.y = 0;
      break;
    }
  }

  // Ground check if not already colliding
  if (!onGround && velocity.y <= 0) {
    const groundCheck = { ...newPos };
    groundCheck.y -= 0.05;
    const groundAABB = playerToAABB(groundCheck);
    for (const entity of entities) {
      if (intersectAABB(groundAABB, entityToAABB(entity))) {
        onGround = true;
        break;
      }
    }
  }

  return { position: newPos, velocity: newVel, onGround };
}
