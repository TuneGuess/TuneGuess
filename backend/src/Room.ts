import { randomUUID } from 'crypto';
import { Player } from './Player';
import { findDeezerTrack, MAX_ROOM_PLAYERS } from './utils';
import { GenericTrack } from './MusicProvider';
import { normalizeServerUrl } from './outbound';

export interface RoomSettings {
  maxRounds: number;
  roundDuration: number;
}

/** Ce que le serveur garde d'un morceau envoyé par un client : jamais d'URL. */
export type StoredTrack = Pick<GenericTrack, 'id' | 'provider' | 'name' | 'artists' | 'albumName'>;
export interface JellyfinSource { serverUrl: string; token: string }

export const MAX_STORED_TRACKS = 200;
const PROVIDERS: GenericTrack['provider'][] = ['lastfm', 'spotify', 'deezer', 'apple-music', 'jellyfin', 'youtube'];
const MAX_TEXT = 300;

/** Valide le contenu de `store_tracks` ; null si quoi que ce soit ne respecte pas le schéma. */
export function parseTrackPayload(payload: unknown): { tracks: StoredTrack[]; jellyfin?: JellyfinSource } | null {
  const { tracks, jellyfin } = (payload ?? {}) as { tracks?: unknown; jellyfin?: unknown };
  if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > MAX_STORED_TRACKS) return null;

  const stored: StoredTrack[] = [];
  for (const t of tracks) {
    if (!t || typeof t !== 'object') return null;
    const { id, provider, name, artists, albumName } = t as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
    if (!PROVIDERS.includes(provider as GenericTrack['provider'])) return null;
    if (typeof name !== 'string' || typeof artists !== 'string') return null;
    if (albumName !== undefined && typeof albumName !== 'string') return null;
    stored.push({
      id,
      provider: provider as GenericTrack['provider'],
      name: name.slice(0, MAX_TEXT),
      artists: artists.slice(0, MAX_TEXT),
      albumName: albumName?.slice(0, MAX_TEXT),
    });
  }

  if (jellyfin === undefined) return { tracks: stored };
  const { serverUrl, token } = (jellyfin ?? {}) as { serverUrl?: unknown; token?: unknown };
  if (typeof token !== 'string' || !/^[\w-]{1,128}$/.test(token)) return null;
  try {
    return { tracks: stored, jellyfin: { serverUrl: normalizeServerUrl(serverUrl), token } };
  } catch {
    return null;
  }
}

export class Room {
  public players: Player[] = [];
  public playerTracks: Record<string, StoredTrack[]> = {};
  public jellyfinSources: Record<string, JellyfinSource> = {};
  public selectionCounts: Record<string, number> = {};
  // mediaKey : identifiant opaque de l'extrait Jellyfin de la manche, seul moyen d'atteindre le proxy.
  public currentQuestion: { track: StoredTrack; playerId: string; mediaKey: string | null } | null = null;
  public answeredPlayers = new Set<string>();
  public roundStartedAtMs: number | null = null;
  public roundEndsAtMs: number | null = null;
  public status: 'waiting' | 'playing' = 'waiting';
  public settings: RoomSettings = { maxRounds: 10, roundDuration: 30 };
  public currentRound = 0;
  public playedTrackIds = new Set<string>();
  public roundTimeout: NodeJS.Timeout | null = null;
  public advancing = false;
  public inactivityTimeout: NodeJS.Timeout | null = null;

  constructor(
    public readonly id: string,
    public name: string,
    public creatorId: string
  ) {}

  public get code(): string {
    return this.id.startsWith('room-') ? this.id.slice(5).toUpperCase() : this.id.toUpperCase();
  }

  public getPublicSummary() {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      playerCount: this.players.length,
      maxPlayers: MAX_ROOM_PLAYERS,
      settings: this.settings,
    };
  }

  public addPlayer(player: Player): void {
    if (this.players.length >= MAX_ROOM_PLAYERS) {
      throw new Error('Le salon est complet.');
    }
    if (this.players.some((p) => p.id === player.id)) {
      throw new Error('Vous êtes déjà dans ce salon.');
    }
    this.players.push(player);
  }

  public removePlayer(playerId: string): void {
    this.players = this.players.filter((p) => p.id !== playerId);
    delete this.playerTracks[playerId];
    delete this.jellyfinSources[playerId];
    delete this.selectionCounts[playerId];

    if (this.creatorId === playerId) {
      this.assignHostIfNeeded();
      if (this.players.length > 0) {
        this.creatorId = this.players.find((p) => p.isHost)?.id || this.players[0].id;
      }
    }
  }

  public assignHostIfNeeded(): void {
    if (this.players.length === 0) return;
    const hasHost = this.players.some((p) => p.isHost);
    if (!hasHost) {
      this.players[0].isHost = true;
      this.creatorId = this.players[0].id;
    }
  }

  public storeTracks(playerId: string, tracks: StoredTrack[], jellyfin?: JellyfinSource): void {
    this.playerTracks[playerId] = tracks;
    if (jellyfin) this.jellyfinSources[playerId] = jellyfin;
    else delete this.jellyfinSources[playerId];
    if (!this.selectionCounts[playerId]) this.selectionCounts[playerId] = 0;
  }

  public async selectNextQuestion() {
    const playerToTracks: Record<string, StoredTrack[]> = {};
    for (const [playerId, tracks] of Object.entries(this.playerTracks)) {
      const unplayed = (tracks || []).filter((track) => {
        return track && (!track.id || !this.playedTrackIds.has(track.id));
      });
      if (unplayed.length > 0) {
        playerToTracks[playerId] = unplayed;
      }
    }

    const playerIdsWithTracks = Object.keys(playerToTracks);
    if (playerIdsWithTracks.length === 0) {
      return null;
    }

    let minCount = Infinity;
    const candidates: string[] = [];
    for (const pid of playerIdsWithTracks) {
      const c = this.selectionCounts[pid] || 0;
      if (c < minCount) {
        minCount = c;
        candidates.length = 0;
        candidates.push(pid);
      } else if (c === minCount) {
        candidates.push(pid);
      }
    }

    const chosenPlayerId = candidates[Math.floor(Math.random() * candidates.length)];
    const tracksForPlayer = playerToTracks[chosenPlayerId];
    const track = tracksForPlayer[Math.floor(Math.random() * tracksForPlayer.length)];
    const fromJellyfin = track.provider === 'jellyfin' && !!this.jellyfinSources[chosenPlayerId];
    const selected = { track, playerId: chosenPlayerId, mediaKey: fromJellyfin ? randomUUID() : null };
    this.selectionCounts[chosenPlayerId] = (this.selectionCounts[chosenPlayerId] || 0) + 1;
    const trackId = track.id;
    if (trackId) this.playedTrackIds.add(trackId);
    const name = track.name;
    const artists = track.artists;
    const deezer = await findDeezerTrack(name, artists);
    let finalPreviewUrl: string | null = deezer?.preview || null;
    let finalImageUrl = deezer?.image || '';
    if (selected.mediaKey) {
      const media = `roomId=${encodeURIComponent(this.id)}&key=${selected.mediaKey}`;
      finalPreviewUrl ||= `/api/proxy/jellyfin/stream?${media}`;
      finalImageUrl ||= `/api/proxy/jellyfin/image?${media}`;
    }

    this.currentRound += 1;

    return {
      selected,
      questionData: {
        track: {
          name,
          artists,
          album: track.albumName || '',
          image: finalImageUrl,
          preview_url: finalPreviewUrl
        },
        players: this.players.map((p) => ({ id: p.id, name: p.name })),
        round: this.currentRound,
        maxRounds: this.settings.maxRounds,
      }
    };
  }

  /** Points calculés ici, au barème qu'appliquait le front : 1000 - ms écoulées, 100 au minimum. */
  public submitAnswer(playerId: string, answerPlayerId: string, nowMs: number): { correct: boolean; correctPlayerId: string } {
    if (!this.currentQuestion || this.answeredPlayers.has(playerId)) {
      throw new Error("Action invalide.");
    }
    if (this.roundStartedAtMs === null || this.roundEndsAtMs === null || nowMs >= this.roundEndsAtMs) {
      throw new Error("Manche terminée.");
    }

    this.answeredPlayers.add(playerId);
    const isCorrect = answerPlayerId === this.currentQuestion.playerId;
    const player = this.players.find((p) => p.id === playerId);

    if (isCorrect && player) {
      player.score += Math.max(1000 - (nowMs - this.roundStartedAtMs), 100);
    }

    return {
      correct: isCorrect,
      correctPlayerId: this.currentQuestion.playerId,
    };
  }

  public clearInactivityTimer(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
  }

  public resetForRound(): void {
    this.answeredPlayers = new Set<string>();
    this.roundStartedAtMs = null;
    this.roundEndsAtMs = null;
    if (this.roundTimeout) {
      clearTimeout(this.roundTimeout);
      this.roundTimeout = null;
    }
  }

  public getRoundState(nowMs: number) {
    const totalPlayers = this.players.length;
    const answeredCount = this.answeredPlayers.size;
    const timeExpired = this.roundEndsAtMs !== null ? nowMs >= this.roundEndsAtMs : false;
    const allAnswered = totalPlayers > 0 ? answeredCount >= totalPlayers : false;

    return {
      endsAtMs: this.roundEndsAtMs,
      totalPlayers,
      answeredCount,
      timeExpired,
      allAnswered,
      canProceed: timeExpired || allAnswered,
    };
  }
}
