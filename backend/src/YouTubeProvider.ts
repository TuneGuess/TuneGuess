import axios from 'axios';
import querystring from 'querystring';
import { MusicProvider, GenericTrack } from './MusicProvider';

export class YouTubeProvider implements MusicProvider {
  private clientId = process.env.GOOGLE_CLIENT_ID;
  private clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private redirectUri = process.env.GOOGLE_REDIRECT_URI || 
    (process.env.REDIRECT_URI 
      ? process.env.REDIRECT_URI.replace('/auth/spotify/callback', '/auth/youtube/callback')
      : 'http://127.0.0.1:5000/auth/youtube/callback');


  public getAuthorizationUrl(): string {
    const scope = 'https://www.googleapis.com/auth/youtube.readonly';
    return 'https://accounts.google.com/o/oauth2/v2/auth?' +
      querystring.stringify({
        response_type: 'code',
        client_id: this.clientId,
        scope: scope,
        redirect_uri: this.redirectUri,
        access_type: 'offline',
        prompt: 'consent'
      });
  }

  public async getAccessToken(code: string): Promise<string> {
    const response = await axios({
      method: 'post',
      url: 'https://oauth2.googleapis.com/token',
      data: querystring.stringify({
        code: code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code'
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response.data.access_token;
  }

  private cleanYouTubeTitle(title: string, channel: string): { name: string; artists: string } {
    let clean = title
      .replace(/\((Official|Lyric|Music|Audio|HD|4K|HQ)\s*(Video|Audio|Clip|Movie|Film)?\)/gi, '')
      .replace(/\[(Official|Lyric|Music|Audio|HD|4K|HQ)\s*(Video|Audio|Clip|Movie|Film)?\]/gi, '')
      .replace(/official\s*(video|audio|clip)?/gi, '')
      .trim();

    const parts = clean.split(/[-–]/);
    if (parts.length >= 2) {
      return {
        artists: parts[0].trim(),
        name: parts.slice(1).join('-').trim()
      };
    }
    
    return {
      artists: channel.replace(/VEVO$/i, '').trim(),
      name: clean
    };
  }

  private async getLikesPlaylistId(token: string): Promise<string> {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'contentDetails',
        mine: true
      },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const likesId = response.data.items?.[0]?.contentDetails?.relatedPlaylists?.likes;
    if (!likesId) {
      throw new Error("Impossible de trouver la playlist des vidéos J'aime");
    }
    return likesId;
  }

  private async getAllLibraryTracks(token: string): Promise<GenericTrack[]> {
    try {
      // 1. Récupérer toutes les playlists créées par l'utilisateur
      const playlistsResponse = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
        params: {
          part: 'snippet',
          mine: true,
          maxResults: 50
        },
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const playlists = playlistsResponse.data.items || [];
      const playlistIds = playlists.map((p: any) => p.id);

      // Ajouter la playlist des vidéos J'aime (likes) au début pour privilégier la nouveauté/récence
      try {
        const likesId = await this.getLikesPlaylistId(token);
        playlistIds.unshift(likesId);
      } catch (err) {
        // Ignorer si pas de likes playlist
      }

      if (playlistIds.length === 0) {
        return [];
      }

      // 2. Récupérer les items de toutes les playlists (limité aux 15 premières pour éviter les surcoûts)
      const targetIds = playlistIds.slice(0, 15);
      const playlistItemsPromises = targetIds.map((playlistId: string) =>
        axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
          params: {
            part: 'snippet',
            playlistId: playlistId,
            maxResults: 50
          },
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(err => {
          console.warn(`Impossible de lire les items de la playlist ${playlistId}:`, err.message);
          return { data: { items: [] } };
        })
      );

      const responses = await Promise.all(playlistItemsPromises);

      // 3. De-dupliquer les vidéos par videoId
      const videoMap = new Map<string, any>();
      for (const res of responses) {
        const items = res.data?.items || [];
        for (const item of items) {
          const videoId = item.snippet?.resourceId?.videoId;
          if (videoId && !videoMap.has(videoId)) {
            videoMap.set(videoId, item);
          }
        }
      }

      const uniqueVideoIds = Array.from(videoMap.keys());
      if (uniqueVideoIds.length === 0) {
        return [];
      }

      // 4. Filtrer les vidéos pour n'avoir que la catégorie Musique (ID 10)
      const musicVideoIds = new Set<string>();
      const chunkSize = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < uniqueVideoIds.length; i += chunkSize) {
        chunks.push(uniqueVideoIds.slice(i, i + chunkSize));
      }

      const videoDetailsPromises = chunks.map(chunk =>
        axios.get('https://www.googleapis.com/youtube/v3/videos', {
          params: {
            part: 'snippet',
            id: chunk.join(',')
          },
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(err => {
          console.warn("Erreur lors de la récupération des détails des vidéos:", err.message);
          return { data: { items: [] } };
        })
      );

      const videoDetailsResponses = await Promise.all(videoDetailsPromises);
      for (const res of videoDetailsResponses) {
        const items = res.data?.items || [];
        for (const item of items) {
          if (item.snippet?.categoryId === '10') {
            musicVideoIds.add(item.id);
          }
        }
      }

      // 5. Construire les objets GenericTrack
      const tracks: GenericTrack[] = [];
      for (const videoId of uniqueVideoIds) {
        if (!musicVideoIds.has(videoId)) {
          continue;
        }
        const item = videoMap.get(videoId);
        const snippet = item.snippet || {};
        const rawTitle = snippet.title || '';
        const channelTitle = snippet.channelTitle || '';
        const imageUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '';

        const { name, artists } = this.cleanYouTubeTitle(rawTitle, channelTitle);

        tracks.push({
          id: videoId,
          provider: 'youtube',
          name: name,
          artists: artists,
          albumName: 'YouTube Music',
          imageUrl: imageUrl,
          previewUrl: null
        });
      }

      return tracks;
    } catch (error: any) {
      console.error("Erreur dans getAllLibraryTracks:", error.message);
      throw error;
    }
  }

  public async getUserTopTracks(token: string): Promise<GenericTrack[]> {
    try {
      const allTracks = await this.getAllLibraryTracks(token);
      return allTracks.slice(0, 50);
    } catch (error: any) {
      console.error("Erreur YouTube getUserTopTracks:", error.message);
      throw error;
    }
  }

  public async getUserRecentTracks(token: string): Promise<GenericTrack[]> {
    try {
      const allTracks = await this.getAllLibraryTracks(token);
      return allTracks.slice(0, 30);
    } catch (error: any) {
      console.error("Erreur YouTube getUserRecentTracks:", error.message);
      throw error;
    }
  }
}
