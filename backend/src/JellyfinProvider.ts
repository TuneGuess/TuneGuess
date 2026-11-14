import { MusicProvider, GenericTrack } from './MusicProvider';
import { normalizeServerUrl, outbound } from './outbound';

export class JellyfinProvider implements MusicProvider {
  private clientHeaders(token?: string) {
    const auth = `MediaBrowser Client="TuneGuess", Device="Web", DeviceId="tuneguess-web-device-id", Version="1.0.0"${token ? `, Token="${token}"` : ""}`;
    return {
      "Authorization": auth,
      "Content-Type": "application/json"
    };
  }

  public getAuthorizationUrl(): string {
    throw new Error("Jellyfin utilise QuickConnect, pas de redirection OAuth standard.");
  }

  public async getAccessToken(code: string): Promise<string> {
    throw new Error("Jellyfin utilise QuickConnect.");
  }

  public async initiateQuickConnect(serverUrl: string): Promise<{ code: string; secret: string }> {
    const url = `${normalizeServerUrl(serverUrl)}/QuickConnect/Initiate`;
    const response = await outbound.post(url, {}, { headers: this.clientHeaders() });
    return {
      code: response.data.Code,
      secret: response.data.Secret
    };
  }

  public async pollQuickConnect(serverUrl: string, secret: string): Promise<{ token: string; userId: string; serverId: string } | null> {
    const cleanUrl = normalizeServerUrl(serverUrl);
    const response = await outbound.get(`${cleanUrl}/QuickConnect/Connect`, {
      params: { secret },
      headers: this.clientHeaders(),
    });
    if (response.data?.Authenticated) {
      const authUrl = `${cleanUrl}/Users/AuthenticateWithQuickConnect`;
      const authResponse = await outbound.post(authUrl, { Secret: secret }, { headers: this.clientHeaders() });
      return {
        token: authResponse.data.AccessToken,
        userId: authResponse.data.User.Id,
        serverId: authResponse.data.ServerId
      };
    }
    return null;
  }

  public async getUserTopTracks(token: string, options?: { serverUrl: string; userId: string }): Promise<GenericTrack[]> {
    if (!options?.serverUrl || !options?.userId) {
      throw new Error("Jellyfin requiert serverUrl et userId.");
    }
    const cleanUrl = normalizeServerUrl(options.serverUrl);
    const userId = encodeURIComponent(options.userId);
    const url = `${cleanUrl}/Users/${userId}/Items?includeItemTypes=Audio&recursive=true&limit=50&sortBy=PlayCount&sortOrder=Descending&filters=IsPlayed`;
    const response = await outbound.get(url, { headers: this.clientHeaders(token) });
    let items = response.data.Items || [];

    if (items.length < 20) {
      const fallbackUrl = `${cleanUrl}/Users/${userId}/Items?includeItemTypes=Audio&recursive=true&limit=50&sortBy=Random`;
      try {
        const fallbackResponse = await outbound.get(fallbackUrl, { headers: this.clientHeaders(token) });
        const fallbackItems = fallbackResponse.data.Items || [];
        const seenIds = new Set(items.map((i: any) => i.Id));
        for (const item of fallbackItems) {
          if (!seenIds.has(item.Id)) {
            items.push(item);
          }
        }
      } catch (err) {
        // Ignorer l'erreur du fallback
      }
    }
    return this.mapItemsToTracks(items.slice(0, 50));
  }

  public async getUserRecentTracks(token: string, options?: { serverUrl: string; userId: string }): Promise<GenericTrack[]> {
    if (!options?.serverUrl || !options?.userId) {
      throw new Error("Jellyfin requiert serverUrl et userId.");
    }
    const cleanUrl = normalizeServerUrl(options.serverUrl);
    const userId = encodeURIComponent(options.userId);
    const url = `${cleanUrl}/Users/${userId}/Items?includeItemTypes=Audio&recursive=true&limit=50&sortBy=DatePlayed&sortOrder=Descending&filters=IsPlayed`;
    const response = await outbound.get(url, { headers: this.clientHeaders(token) });
    let items = response.data.Items || [];

    if (items.length < 20) {
      const fallbackUrl = `${cleanUrl}/Users/${userId}/Items?includeItemTypes=Audio&recursive=true&limit=50&sortBy=DateCreated&sortOrder=Descending`;
      try {
        const fallbackResponse = await outbound.get(fallbackUrl, { headers: this.clientHeaders(token) });
        const fallbackItems = fallbackResponse.data.Items || [];
        const seenIds = new Set(items.map((i: any) => i.Id));
        for (const item of fallbackItems) {
          if (!seenIds.has(item.Id)) {
            items.push(item);
          }
        }
      } catch (err) {
        // Ignorer l'erreur du fallback
      }
    }
    return this.mapItemsToTracks(items.slice(0, 50));
  }

  /** Extrait audio ou pochette d'un morceau, URL reconstruite côté serveur. */
  public fetchMedia(serverUrl: string, token: string, itemId: string, kind: 'stream' | 'image', range?: string) {
    const id = encodeURIComponent(itemId);
    const path = kind === 'stream'
      ? `/Audio/${id}/stream?static=true`
      : `/Items/${id}/Images/Primary?fillWidth=300&fillHeight=300`;
    return outbound.get(`${normalizeServerUrl(serverUrl)}${path}`, {
      responseType: 'stream',
      headers: { ...this.clientHeaders(token), ...(range ? { Range: range } : {}) },
    });
  }

  private mapItemsToTracks(items: any[]): GenericTrack[] {
    return items.map((item) => {
      const artists = Array.isArray(item.Artists) ? item.Artists.join(', ') : (item.AlbumArtist || '');
      return {
        id: item.Id,
        provider: 'jellyfin',
        name: item.Name,
        artists: artists || 'Artiste Inconnu',
        albumName: item.Album || '',
        previewUrl: null
      };
    });
  }
}
