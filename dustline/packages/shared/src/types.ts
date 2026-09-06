export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export type Team = 'T' | 'CT' | 'SPECTATOR';

export interface WeaponType {
  id: string;
  name: string;
  damage: number;
  fireRate: number; // ms between shots
  reloadTime: number; // ms
  magazineSize: number;
  totalAmmo: number;
  range: number;
  spread: number;
  automatic: boolean;
}

export interface WeaponState {
  typeId: string;
  ammoInMagazine: number;
  ammoInReserve: number;
  isReloading: boolean;
  lastFireTime: number;
  reloadStartTime: number;
}

export interface PlayerState {
  id: string;
  username: string;
  team: Team;
  position: Vec3;
  rotation: Vec2; // yaw, pitch
  velocity: Vec3;
  health: number;
  armor: number;
  isDead: boolean;
  isWalking: boolean;
  primaryWeapon: WeaponState | null;
  secondaryWeapon: WeaponState | null;
  currentWeaponSlot: 'primary' | 'secondary';
  inputSeq: number;
}

export interface BulletState {
  id: string;
  shooterId: string;
  origin: Vec3;
  direction: Vec3;
  damage: number;
  createdAt: number;
}

export interface EntityState {
  id: string;
  type: 'box' | 'wall' | 'floor' | 'ramp';
  position: Vec3;
  size: Vec3;
  rotation?: Vec3;
}

export interface MatchState {
  id: string;
  status: 'warmup' | 'live' | 'ended';
  tScore: number;
  ctScore: number;
  timeRemaining: number;
  mapName: string;
}

export interface GameSnapshot {
  tick: number;
  timestamp: number;
  match: MatchState;
  players: PlayerState[];
  bullets: BulletState[];
  entities: EntityState[];
}

export interface InputState {
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
  timestamp: number;
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
}

export interface MapData {
  name: string;
  spawnPoints: { team: Team; position: Vec3; rotation: Vec2 }[];
  entities: EntityState[];
  skyColor: string;
  ambientLight: number;
}
