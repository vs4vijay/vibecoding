import type { Vec3, Vec2, Team, WeaponState, PlayerState, MatchState, EntityState, BulletState, PlayerStats, MapData } from '@cs-clone/shared';

export interface ServerPlayer {
  id: string;
  username: string;
  team: Team;
  position: Vec3;
  rotation: Vec2;
  velocity: Vec3;
  health: number;
  armor: number;
  isDead: boolean;
  isWalking: boolean;
  isGrounded: boolean;
  primaryWeapon: WeaponState | null;
  secondaryWeapon: WeaponState | null;
  currentWeaponSlot: 'primary' | 'secondary';
  inputSeq: number;
  stats: PlayerStats;
  respawnTimer: number;
  lastInputTime: number;
  // Internal physics
  onGround: boolean;
}

export interface ServerBullet {
  id: string;
  shooterId: string;
  origin: Vec3;
  direction: Vec3;
  damage: number;
  createdAt: number;
  weaponId: string;
  hitPlayerId: string | null;
  expired: boolean;
}

export interface ServerMatch {
  id: string;
  status: 'warmup' | 'live' | 'ended';
  tScore: number;
  ctScore: number;
  timeRemaining: number;
  mapData: MapData;
  startTime: number;
  endTime: number;
  tick: number;
}

export interface ServerGameState {
  match: ServerMatch;
  players: Map<string, ServerPlayer>;
  bullets: ServerBullet[];
  entities: EntityState[];
  tick: number;
  lastSnapshotTime: number;
}

export interface QueuedInput {
  playerId: string;
  input: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    jump: boolean;
    walk: boolean;
    fire: boolean;
    reload: boolean;
    weaponSlot: 'primary' | 'secondary' | null;
    yaw: number;
    pitch: number;
    seq: number;
  };
  timestamp: number;
}
