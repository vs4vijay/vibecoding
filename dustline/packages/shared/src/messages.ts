import type { GameSnapshot, InputState, Team, PlayerState } from './types.js';

export type ClientMessage =
  | { type: 'join'; username: string; team: Team }
  | { type: 'input'; data: InputState }
  | { type: 'respawn' }
  | { type: 'switchTeam'; team: Team };

export type ServerMessage =
  | { type: 'snapshot'; snapshot: GameSnapshot }
  | { type: 'joined'; playerId: string; snapshot: GameSnapshot }
  | { type: 'hit'; damage: number; healthLeft: number; shooterId: string }
  | { type: 'kill'; killerId: string; victimId: string; weaponName: string; headshot: boolean }
  | { type: 'death'; killerId: string; weaponName: string }
  | { type: 'chat'; senderId: string; senderName: string; message: string; teamOnly: boolean }
  | { type: 'error'; message: string }
  | { type: 'playerJoined'; player: PlayerState }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'matchStart'; matchId: string }
  | { type: 'matchEnd'; tScore: number; ctScore: number; winner: Team };
