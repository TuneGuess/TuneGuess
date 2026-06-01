import { Room } from './Room';
import { Player } from './Player';
import { generateRoomCode } from './utils';

export class RoomManager {
  private rooms: Record<string, Room> = {};

  public createRoom(roomName: string, hostId: string, hostName: string): Room {
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

  public deleteRoomIfEmpty(roomId: string): boolean {
    const room = this.rooms[roomId];
    if (room && room.players.length === 0) {
      delete this.rooms[roomId];
      return true;
    }
    return false;
  }

  public getPublicRoomList() {
    return Object.values(this.rooms)
      .filter((r) => r.status === 'waiting' && r.players.length < 10)
      .map((r) => r.getPublicSummary());
  }
}
