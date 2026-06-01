import axios from 'axios';
import querystring from 'querystring';
import { MusicProvider, GenericTrack } from './MusicProvider';

export class SpotifyProvider implements MusicProvider {
  private clientId = process.env.SPOTIFY_CLIENT_ID;
  private clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  private redirectUri = process.env.REDIRECT_URI;

  public getAuthorizationUrl(): string {
    const scope = 'user-read-recently-played user-top-read';
    return 'https://accounts.spotify.com/authorize?' +
      querystring.stringify({
        response_type: 'code',
        client_id: this.clientId,
        scope: scope,
        redirect_uri: this.redirectUri,
      });
  }

  public async getAccessToken(code: string): Promise<string> {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      data: querystring.stringify({
        code: code,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code'
      }),
      headers: {
        'Authorization': 'Basic ' + (Buffer.from(this.clientId + ':' + this.clientSecret).toString('base64')),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response.data.access_token;
  }

  public async getUserTopTracks(token: string): Promise<GenericTrack[]> {
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/top/tracks?limit=20',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    return (response.data.items || []).map((item: any) => ({
      id: item.id || '',
      provider: 'spotify',
      name: item.name || '',
      artists: (item.artists || []).map((a: any) => a.name).join(', '),
      albumName: item.album?.name || '',
      imageUrl: item.album?.images?.[0]?.url || '',
      previewUrl: item.preview_url || null,
    }));
  }

  public async getUserRecentTracks(token: string): Promise<GenericTrack[]> {
    const response = await axios({
      method: 'get',
      url: 'https://api.spotify.com/v1/me/player/recently-played?limit=50',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    return (response.data.items || []).map((recentItem: any) => {
      const item = recentItem.track || {};
      return {
        id: item.id || '',
        provider: 'spotify',
        name: item.name || '',
        artists: (item.artists || []).map((a: any) => a.name).join(', '),
        albumName: item.album?.name || '',
        imageUrl: item.album?.images?.[0]?.url || '',
        previewUrl: item.preview_url || null,
      };
    });
  }
}
