import { Room } from './Room';
import { Player } from './Player';
import { generateRoomCode, MAX_ROOM_PLAYERS } from './utils';

// Plafond global : chaque salon garde des morceaux et des minuteries en mémoire.
export const MAX_ROOMS = 500;

export class RoomManager {
  private rooms: Record<string, Room> = {};

  public createRoom(roomName: string, hostId: string, hostName: string): Room {
    if (Object.keys(this.rooms).length >= MAX_ROOMS) {
      throw new Error('Trop de salons ouverts, réessayez plus tard.');
    }
    let code: string;
    let roomId: string;
    do {
      code = generateRoomCode();
      roomId = `room-${code}`;
    } while (this.rooms[roomId]);

    const room = new Room(roomId, roomName, hostId);
    const host = new Player(hostId, hostName, 0, true);
    room.addPlayer(host);

    this.rooms[roomId] = room;
    return room;
  }

  public findRoomByCode(code: unknown): Room | null {
    if (!code || typeof code !== 'string') return null;
    const normalized = code.trim().toUpperCase();
    const roomId = `room-${normalized}`;
    return this.rooms[roomId] || null;
  }

  public getRoomById(roomId: string | undefined): Room | null {
    if (!roomId) return null;
    return this.rooms[roomId] || null;
  }

  public getAllRooms(): Room[] {
    return Object.values(this.rooms);
  }

  public deleteRoom(roomId: string): boolean {
    const room = this.rooms[roomId];
    if (!room) {
      return false;
    }
    // Minuteries arrêtées : sinon elles gardent le salon en mémoire et se déclenchent après coup.
    room.resetForRound();
    room.clearInactivityTimer();
    delete this.rooms[roomId];
    return true;
  }

  public deleteRoomIfEmpty(roomId: string): boolean {
    const room = this.rooms[roomId];
    return !!room && room.players.length === 0 && this.deleteRoom(roomId);
  }

  public getPublicRoomList() {
    return Object.values(this.rooms)
      .filter((r) => r.status === 'waiting' && r.players.length < MAX_ROOM_PLAYERS)
      .map((r) => r.getPublicSummary());
  }
}
