import axios from 'axios';
import querystring from 'querystring';
import { MusicProvider, GenericTrack } from './MusicProvider';

export class DeezerProvider implements MusicProvider {
    private appId = process.env.DEEZER_APP_ID;
    private appSecret = process.env.DEEZER_APP_SECRET;
    private redirectUri = process.env.REDIRECT_URI;

    public getAuthorizationUrl(): string {
        const scope = 'basic_access listening_history';
        return 'https://connect.deezer.com/oauth/auth.php?' +
            querystring.stringify({
                app_id: this.appId,
                redirect_uri: this.redirectUri,
                perms: scope,
            });
    }

    public async getAccessToken(code: string): Promise<string> {
        const response = await axios({
            method: 'get',
            url: 'https://connect.deezer.com/oauth/access_token.php',
            params: {
                app_id: this.appId,
                secret: this.appSecret,
                code: code,
                output: 'json'
            }
        });

        if (response.data && response.data.access_token) {
            return response.data.access_token;
        }

        throw new Error("Impossible de récupérer l'access token Deezer");
    }

    public async getUserTopTracks(token: string): Promise<GenericTrack[]> {
        const response = await axios({
            method: 'get',
            url: 'https://api.deezer.com/user/me/charts/tracks',
            params: { access_token: token, limit: 20 }
        });

        const tracks = response.data.data || [];

        return tracks.map((item: any) => ({
            id: String(item.id) || '',
            provider: 'deezer',
            name: item.title || '',
            artists: item.artist?.name || 'Artiste Inconnu',
            albumName: item.album?.title || '',
            imageUrl: item.album?.cover_medium || '',
            previewUrl: item.preview || null,
        }));
    }

    public async getUserRecentTracks(token: string): Promise<GenericTrack[]> {
        const response = await axios({
            method: 'get',
            url: 'https://api.deezer.com/user/me/history',
            params: { access_token: token, limit: 50 }
        });

        const tracks = response.data.data || [];

        return tracks.map((item: any) => ({
            id: String(item.id) || '',
            provider: 'deezer',
            name: item.title || '',
            artists: item.artist?.name || 'Artiste Inconnu',
            albumName: item.album?.title || '',
            imageUrl: item.album?.cover_medium || '',
            previewUrl: item.preview || null,
        }));
    }
}