import type { Vec3, EntityState } from '@cs-clone/shared';
import { PLAYER_RADIUS, PLAYER_HEIGHT } from '@cs-clone/shared';

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function entityToAABB(entity: EntityState): AABB {
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

export function playerToAABB(position: Vec3): AABB {
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

export function intersectAABB(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

export function intersectRayAABB(origin: Vec3, direction: Vec3, aabb: AABB): { t: number; point: Vec3 } | null {
  let tmin = -Infinity;
  let tmax = Infinity;

  for (const axis of ['x', 'y', 'z'] as const) {
    if (direction[axis] !== 0) {
      const t1 = (aabb.min[axis] - origin[axis]) / direction[axis];
      const t2 = (aabb.max[axis] - origin[axis]) / direction[axis];
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    } else if (origin[axis] < aabb.min[axis] || origin[axis] > aabb.max[axis]) {
      return null;
    }
  }

  if (tmax >= tmin && tmax >= 0) {
    const t = tmin >= 0 ? tmin : tmax;
    return {
      t,
      point: {
        x: origin.x + direction.x * t,
        y: origin.y + direction.y * t,
        z: origin.z + direction.z * t,
      },
    };
  }

  return null;
}

export function resolvePlayerCollision(
  position: Vec3,
  velocity: Vec3,
  entities: EntityState[],
  dt: number
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
