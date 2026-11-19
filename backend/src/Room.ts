import { randomUUID } from 'crypto';
import { Player } from './Player';
import { findDeezerTrack, getDeezerTrackById, MAX_ROOM_PLAYERS, safeImageUrl } from './utils';
import { GenericTrack } from './MusicProvider';
import { normalizeServerUrl } from './outbound';
import { computePoints, DEFAULT_SCORING, pickOwner, ScoringSettings } from './comptes/jeu';

export interface RoomSettings extends ScoringSettings {
  maxRounds: number;
  roundDuration: number;
}

/** Journal d'une manche, enregistré dans l'historique des joueurs ayant un compte. */
export interface RoundLog {
  no: number;
  trackName: string;
  artists: string;
  ownerKey: string;
  ownerName: string;
  answers: { playerKey: string; answerKey: string; answerName: string; correct: boolean; timeMs: number; points: number }[];
}

/** Ce que le serveur garde d'un morceau envoyé par un client : seule URL, une image d'un hôte autorisé. */
export type StoredTrack = Pick<GenericTrack, 'id' | 'provider' | 'name' | 'artists' | 'albumName' | 'imageUrl' | 'deezerId'>;
export interface JellyfinSource { serverUrl: string; token: string }

export const MAX_STORED_TRACKS = 200;
const PROVIDERS: GenericTrack['provider'][] = ['lastfm', 'deezer', 'apple-music', 'jellyfin', 'youtube'];
const MAX_TEXT = 300;

/** Valide le contenu de `store_tracks` ; null si quoi que ce soit ne respecte pas le schéma. */
export function parseTrackPayload(payload: unknown): { tracks: StoredTrack[]; jellyfin?: JellyfinSource } | null {
  const { tracks, jellyfin } = (payload ?? {}) as { tracks?: unknown; jellyfin?: unknown };
  if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > MAX_STORED_TRACKS) return null;

  const stored: StoredTrack[] = [];
  for (const t of tracks) {
    if (!t || typeof t !== 'object') return null;
    const { id, provider, name, artists, albumName, imageUrl, deezerId } = t as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
    if (!PROVIDERS.includes(provider as GenericTrack['provider'])) return null;
    if (typeof name !== 'string' || typeof artists !== 'string') return null;
    if (albumName !== undefined && typeof albumName !== 'string') return null;
    if (deezerId !== undefined && (typeof deezerId !== 'string' || !/^\d{1,20}$/.test(deezerId))) return null;
    stored.push({
      id,
      provider: provider as GenericTrack['provider'],
      name: name.slice(0, MAX_TEXT),
      artists: artists.slice(0, MAX_TEXT),
      albumName: albumName?.slice(0, MAX_TEXT),
      imageUrl: safeImageUrl(imageUrl), // hôte non autorisé : image ignorée, morceau gardé
      deezerId,
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
  public lastOwner: string | null = null;
  public rounds: RoundLog[] = [];
  public startedAt = 0;
  // mediaKey : identifiant opaque de l'extrait Jellyfin de la manche, seul moyen d'atteindre le proxy.
  public currentQuestion: { track: StoredTrack; playerId: string; mediaKey: string | null } | null = null;
  public answeredPlayers = new Set<string>();
  public roundStartedAtMs: number | null = null;
  public roundEndsAtMs: number | null = null;
  public status: 'waiting' | 'playing' = 'waiting';
  public settings: RoomSettings = { maxRounds: 10, roundDuration: 30, ...DEFAULT_SCORING };
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
  }

  /** Prêt = a envoyé des pistes dans ce salon. */
  public isReady(playerId: string): boolean {
    return (this.playerTracks[playerId]?.length ?? 0) > 0;
  }

  public readyCount(): number {
    return this.players.filter((p) => this.isReady(p.id)).length;
  }

  /** Ce que les autres joueurs voient d'un joueur (jamais son identifiant de compte). */
  public publicPlayers() {
    return this.players.map((p) => ({ id: p.id, name: p.name, username: p.username, score: p.score, isHost: p.isHost, ready: this.isReady(p.id) }));
  }

  /** Remise à zéro au lancement d'une partie. */
  public startGame(nowMs: number): void {
    this.status = 'playing';
    this.resetForRound();
    this.currentRound = 0;
    this.playedTrackIds = new Set<string>();
    this.lastOwner = null;
    this.rounds = [];
    this.startedAt = nowMs;
    for (const p of this.players) p.score = 0;
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

    const chosenPlayerId = pickOwner(playerIdsWithTracks, this.lastOwner)!;
    this.lastOwner = chosenPlayerId;
    const tracksForPlayer = playerToTracks[chosenPlayerId];
    const track = tracksForPlayer[Math.floor(Math.random() * tracksForPlayer.length)];
    const fromJellyfin = track.provider === 'jellyfin' && !!this.jellyfinSources[chosenPlayerId];
    const selected = { track, playerId: chosenPlayerId, mediaKey: fromJellyfin ? randomUUID() : null };
    const trackId = track.id;
    if (trackId) this.playedTrackIds.add(trackId);
    const name = track.name;
    const artists = track.artists;
    const deezer = (track.deezerId && (await getDeezerTrackById(track.deezerId))) || (await findDeezerTrack(name, artists));
    let finalPreviewUrl: string | null = deezer?.preview || null;
    let finalImageUrl = deezer?.image || track.imageUrl || '';
    if (selected.mediaKey) {
      const media = `roomId=${encodeURIComponent(this.id)}&key=${selected.mediaKey}`;
      finalPreviewUrl ||= `/api/proxy/jellyfin/stream?${media}`;
      finalImageUrl ||= `/api/proxy/jellyfin/image?${media}`;
    }

    this.currentRound += 1;
    const owner = this.players.find((p) => p.id === chosenPlayerId);
    this.rounds.push({ no: this.currentRound, trackName: name, artists, ownerKey: chosenPlayerId, ownerName: owner?.name ?? '', answers: [] });

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

  /** Points au temps selon le barème du salon ; bonus à la première bonne réponse de la manche. */
  public submitAnswer(playerId: string, answerPlayerId: string, nowMs: number): { correct: boolean; correctPlayerId: string; points: number } {
    if (!this.currentQuestion || this.answeredPlayers.has(playerId)) {
      throw new Error("Action invalide.");
    }
    if (this.roundStartedAtMs === null || this.roundEndsAtMs === null || nowMs >= this.roundEndsAtMs) {
      throw new Error("Manche terminée.");
    }
    if (playerId === this.currentQuestion.playerId) {
      throw new Error("C'est ta piste : tu ne réponds pas à cette manche.");
    }

    this.answeredPlayers.add(playerId);
    const isCorrect = answerPlayerId === this.currentQuestion.playerId;
    const player = this.players.find((p) => p.id === playerId);

    const elapsed = nowMs - this.roundStartedAtMs;
    const log = this.rounds[this.rounds.length - 1];
    const first = !log?.answers.some((a) => a.correct);
    const points = isCorrect && player ? computePoints(elapsed, this.roundEndsAtMs - this.roundStartedAtMs, this.settings, first) : 0;
    if (player) player.score += points;
    log?.answers.push({
      playerKey: playerId,
      answerKey: String(answerPlayerId),
      answerName: this.players.find((p) => p.id === answerPlayerId)?.name ?? '',
      correct: isCorrect,
      timeMs: elapsed,
      points,
    });

    return {
      correct: isCorrect,
      correctPlayerId: this.currentQuestion.playerId,
      points,
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
    // Le propriétaire de la piste ne répond pas : il n'est pas attendu.
    const owner = this.currentQuestion?.playerId;
    const totalPlayers = this.players.filter((p) => p.id !== owner).length;
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
