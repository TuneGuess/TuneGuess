import axios from 'axios';
import { MusicProvider, GenericTrack } from './MusicProvider';

export class LastFmProvider implements MusicProvider {
  private apiKey = process.env.LASTFM_API_KEY;

  public getAuthorizationUrl(): string {
    throw new Error("Last.fm est configuré en mode API publique via le nom d'utilisateur. Pas de connexion requise.");
  }

  public async getAccessToken(code: string): Promise<string> {
    throw new Error("Pas besoin de token pour le mode public Last.fm.");
  }

  /**
   * Récupère les morceaux les plus écoutés d'un utilisateur Last.fm
   * @param username Le nom d'utilisateur Last.fm passé à la place du token
   */
  public async getUserTopTracks(username: string): Promise<GenericTrack[]> {
    if (!this.apiKey) throw new Error("LASTFM_API_KEY manquante dans le .env");

    const response = await axios.get('https://ws.audioscrobbler.com/2.0/', {
      params: {
        method: 'user.gettoptracks',
        user: username,
        api_key: this.apiKey,
        format: 'json',
        limit: 20
      }
    });

    const tracks = response.data?.toptracks?.track || [];
    return this.enrichTracksWithDeezer(tracks);
  }

  /**
   * Récupère les morceaux récents (historique) d'un utilisateur Last.fm
   * @param username Le nom d'utilisateur Last.fm passé à la place du token
   */
  public async getUserRecentTracks(username: string): Promise<GenericTrack[]> {
    if (!this.apiKey) throw new Error("LASTFM_API_KEY manquante dans le .env");

    const response = await axios.get('https://ws.audioscrobbler.com/2.0/', {
      params: {
        method: 'user.getrecenttracks',
        user: username,
        api_key: this.apiKey,
        format: 'json',
        limit: 30 
      }
    });

    const tracks = response.data?.recenttracks?.track || [];
    
    const normalizedTracks = tracks.map((t: any) => ({
      name: t.name,
      artist: { name: t.artist?.['#text'] || t.artist?.name || '' },
      album: { title: t.album?.['#text'] || '' }
    }));

    return this.enrichTracksWithDeezer(normalizedTracks);
  }

  /**
   * Enrichit les morceaux Last.fm avec les previews audio et covers de l'API Deezer
   */
  private async enrichTracksWithDeezer(lastFmTracks: any[]): Promise<GenericTrack[]> {
    const genericTracks: GenericTrack[] = [];

    // Recherches Deezer par lots de 5 en parallèle : rapide sans inonder l'API.
    for (let i = 0; i < lastFmTracks.length && genericTracks.length < 20; i += 5) {
      const found = await Promise.all(lastFmTracks.slice(i, i + 5).map((track) => this.findOnDeezer(track)));
      for (const track of found) if (track) genericTracks.push(track);
    }

    return genericTracks.slice(0, 20);
  }

  private async findOnDeezer(track: any): Promise<GenericTrack | null> {
    const trackName = track.name || '';
    const artistName = track.artist?.name || track.artist?.['#text'] || '';
    const albumName = track.album?.title || '';

    try {
      // Recherche du morceau exact sur l'API publique de Deezer
      const query = `artist:"${artistName}" track:"${trackName}"`;
      const deezerSearch = await axios.get('https://api.deezer.com/search', {
        params: { q: query, limit: 1 }
      });

      const deezerTrack = deezerSearch.data?.data?.[0];

      // On ne l'ajoute que si Deezer a trouvé un extrait audio valide pour le jeu
      if (!deezerTrack?.preview) return null;
      return {
        id: `lastfm-${deezerTrack.id || Math.random().toString(36).substr(2, 9)}`,
        provider: 'lastfm',
        name: trackName,
        artists: artistName || 'Artiste Inconnu',
        albumName: albumName || deezerTrack.album?.title || '',
        imageUrl: deezerTrack.album?.cover_medium || '',
        previewUrl: deezerTrack.preview,
        deezerId: deezerTrack.id ? String(deezerTrack.id) : undefined,
      };
    } catch {
      return null;
    }
  }
}
