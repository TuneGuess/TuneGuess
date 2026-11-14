import axios from 'axios';
import { createHash, timingSafeEqual } from 'crypto';

export const MAX_NAME_LENGTH = 20;
export const MAX_ROOM_PLAYERS = 10;
export const ROOM_CODE_LENGTH = 5;

export function sanitizeInput(text: unknown, maxLen = MAX_NAME_LENGTH): string {
  if (typeof text !== 'string') return '';
  // Valeur brute : Vue échappe à l'affichage, échapper ici affichait « &amp; » à l'écran.
  return text.trim().slice(0, maxLen);
}

/** Comparaison en temps constant (les empreintes ont toujours la même longueur). */
export function safeEqual(a: string, b: string): boolean {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(a), digest(b));
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

// Hôtes d'images que le navigateur peut charger (pochettes Spotify, YouTube, Deezer) : https seulement.
const IMAGE_HOSTS = ['scdn.co', 'ytimg.com', 'dzcdn.net'];

export function safeImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    const allowed = IMAGE_HOSTS.some((h) => url.hostname.endsWith(`.${h}`)) // sous-domaines seulement, comme la CSP https://*.<hôte>;
    return url.protocol === 'https:' && allowed && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Extrait d'un morceau Deezer connu ; l'id est numérique (validé à la réception), l'hôte est fixe. */
export const getDeezerTrackById = async (deezerId: string): Promise<{ preview: string; image: string } | null> => {
  try {
    const { data } = await axios.get(`https://api.deezer.com/track/${encodeURIComponent(deezerId)}`);
    if (data?.preview) return { preview: data.preview, image: data.album?.cover_medium || '' };
  } catch (error: any) {
    console.error(`Erreur Deezer pour le morceau ${deezerId}:`, error.message);
  }
  return null;
};

// Minuscules, sans accents ni ponctuation : « Beyoncé » et « beyonce » se valent.
const normalize = (text: string) => text.normalize('NFD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export const findDeezerTrack = async (trackName: string, artistName: string): Promise<{ preview: string; image: string } | null> => {
  try {
    const cleanTrack = trackName.split(/[(\[-]/)[0].trim();
    // Premier artiste seulement (« A, B » ou « A & B ») : celui qu'indexe Deezer.
    const cleanArtist = artistName.split(/[(\[\-,&]/)[0].trim();
    const wanted = normalize(cleanArtist);

    const response = await axios.get('https://api.deezer.com/search', {
      params: { q: `${cleanArtist} ${cleanTrack}`, limit: 10 },
    });

    // Le premier résultat peut être un autre artiste (reprise, homonyme) : on vérifie l'artiste.
    const item = (response.data?.data || []).find((d: any) => {
      const found = normalize(d?.artist?.name || '');
      return d?.preview && found && wanted && (found.includes(wanted) || wanted.includes(found));
    });
    if (item) {
      return { preview: item.preview, image: item.album?.cover_medium || '' };
    }
  } catch (error: any) {
    console.error(`Erreur recherche Deezer pour "${artistName} - ${trackName}":`, error.message);
  }
  return null;
};
