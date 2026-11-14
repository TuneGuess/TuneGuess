export interface GenericTrack {
  id: string;
  provider: 'lastfm' | 'spotify' | 'deezer' | 'apple-music' | 'jellyfin' | 'youtube';
  name: string;
  artists: string;
  albumName?: string;
  imageUrl?: string;
  previewUrl: string | null;
  /** Id Deezer déjà validé : le serveur en retrouve l'extrait sur api.deezer.com (hôte fixe). */
  deezerId?: string;
}

export interface MusicProvider {
  getAuthorizationUrl(state?: string): string;
  getAccessToken(code: string): Promise<string>;
  getUserTopTracks(token: string, options?: any): Promise<GenericTrack[]>;
  getUserRecentTracks(token: string, options?: any): Promise<GenericTrack[]>;
}
