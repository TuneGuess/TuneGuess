export interface GenericTrack {
  id: string;
  provider: 'lastfm' | 'spotify' | 'deezer' | 'apple-music' | 'jellyfin';
  name: string;
  artists: string;
  albumName?: string;
  imageUrl?: string;
  previewUrl: string | null;
}

export interface MusicProvider {
  getAuthorizationUrl(): string;
  getAccessToken(code: string): Promise<string>;
  getUserTopTracks(token: string, options?: any): Promise<GenericTrack[]>;
  getUserRecentTracks(token: string, options?: any): Promise<GenericTrack[]>;
}
