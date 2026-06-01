import axios from 'axios';

export const MAX_NAME_LENGTH = 20;
export const MAX_ROOM_PLAYERS = 10;
export const ROOM_CODE_LENGTH = 5;

export function escapeHtml(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeInput(text: unknown, maxLen = MAX_NAME_LENGTH): string {
  if (typeof text !== 'string') return '';
  return escapeHtml(text.trim().slice(0, maxLen));
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function getRoomCodeFromId(roomId: string | undefined): string {
  if (!roomId || typeof roomId !== 'string') return '';
  return roomId.startsWith('room-') ? roomId.slice(5).toUpperCase() : roomId.toUpperCase();
}

export const fetchDeezerPreview = async (trackName: string, artistName: string): Promise<string | null> => {
  try {
    const cleanTrack = trackName.split(/[(\[-]/)[0].trim();
    const cleanArtist = artistName.split(/[(\[-]/)[0].trim();
    const query = `${cleanArtist} ${cleanTrack}`;

    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url);

    if (response.data?.data?.length > 0) {
      return response.data.data[0].preview;
    }
  } catch (error: any) {
    console.error(`Erreur recherche Deezer pour "${artistName} - ${trackName}":`, error.message);
  }
  return null;
};
