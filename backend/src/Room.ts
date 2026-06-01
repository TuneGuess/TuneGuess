import { Player } from './Player';
import { fetchDeezerPreview, MAX_ROOM_PLAYERS } from './utils';
import { GenericTrack } from './MusicProvider';

export interface RoomSettings {
  maxRounds: number;
  roundDuration: number;
}

export class Room {
  public players: Player[] = [];
  public playerTracks: Record<string, GenericTrack[]> = {};
  public currentQuestion: { track: GenericTrack; playerId: string } | null = null;
  public answeredPlayers = new Set<string>();
  public roundEndsAtMs: number | null = null;
  public status: 'waiting' | 'playing' = 'waiting';
  public settings: RoomSettings = { maxRounds: 10, roundDuration: 30 };
  public currentRound = 0;
  public playedTrackIds = new Set<string>();
  public roundTimeout: NodeJS.Timeout | null = null;

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

  public storeTracks(playerId: string, tracks: GenericTrack[]): void {
    this.playerTracks[playerId] = tracks;
  }

  public async selectNextQuestion() {
    // Regrouper les morceaux non joués par joueur (sans exclure ceux sans previewUrl)
    const playerToTracks: Record<string, GenericTrack[]> = {};
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

    // Choisir un joueur au hasard parmi ceux qui ont encore des morceaux non joués
    const randomPlayerId = playerIdsWithTracks[Math.floor(Math.random() * playerIdsWithTracks.length)];
    const tracksForPlayer = playerToTracks[randomPlayerId];
    
    // Choisir un morceau au hasard pour ce joueur
    const track = tracksForPlayer[Math.floor(Math.random() * tracksForPlayer.length)];
    const selected = { track, playerId: randomPlayerId };

    const trackId = track.id;
    if (trackId) this.playedTrackIds.add(trackId);

    const name = track.name;
    const artists = track.artists;
    
    // Essayer de trouver un extrait officiel Deezer d'abord (pour la légalité et la pertinence du chorus)
    let previewUrl = await fetchDeezerPreview(name, artists);

    let finalPreviewUrl = previewUrl;
    let finalImageUrl = track.imageUrl || '';

    // Si pas d'extrait Deezer, on se replie sur l'extrait d'origine (Jellyfin proxy ou Spotify)
    if (!finalPreviewUrl) {
      if (track.provider === 'jellyfin' && track.previewUrl) {
        finalPreviewUrl = `/api/proxy/jellyfin/stream?roomId=${this.id}&playerId=${selected.playerId}&trackId=${track.id}`;
      } else {
        finalPreviewUrl = track.previewUrl || null;
      }
    }

    // L'image de Jellyfin passe toujours par le proxy pour masquer l'URL du serveur privé
    if (track.provider === 'jellyfin' && track.imageUrl) {
      finalImageUrl = `/api/proxy/jellyfin/image?roomId=${this.id}&playerId=${selected.playerId}&trackId=${track.id}`;
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

  public submitAnswer(playerId: string, answerPlayerId: string, points: number): { correct: boolean; correctPlayerId: string } {
    if (!this.currentQuestion || this.answeredPlayers.has(playerId)) {
      throw new Error("Action invalide.");
    }

    this.answeredPlayers.add(playerId);
    const isCorrect = answerPlayerId === this.currentQuestion.playerId;
    const player = this.players.find((p) => p.id === playerId);

    if (isCorrect && player) {
      const safePoints = Math.min(10000, Math.max(0, Number(points) || 0));
      player.score += safePoints;
    }

    return {
      correct: isCorrect,
      correctPlayerId: this.currentQuestion.playerId,
    };
  }

  public resetForRound(): void {
    this.answeredPlayers = new Set<string>();
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
