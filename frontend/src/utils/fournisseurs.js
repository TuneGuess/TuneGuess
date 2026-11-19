export const PROVIDER_LABELS = { google: 'Google', youtube: 'YouTube', lastfm: 'Last.fm', jellyfin: 'Jellyfin' };

export const formatDate = (ms) => (ms ? new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
