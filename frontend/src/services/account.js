import { API_BASE } from '@/config';

/** Appels de l'API compte : cookie de session httpOnly, jamais de jeton côté navigateur. */
export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Erreur réseau');
    Object.assign(error, { status: response.status, code: payload.code });
    throw error;
  }
  return payload;
}

/** Redirection OAuth (Google : connexion ; YouTube/Last.fm : liaison de source). */
export const oauthUrl = (provider, intent = 'login') => `${API_BASE}/auth/compte/${provider}/start?intent=${intent}`;

// Messages des codes d'erreur renvoyés dans ?erreur= après une redirection OAuth.
export const OAUTH_ERRORS = {
  OAUTH_STATE: 'La connexion a expiré ou vient d\'un autre onglet : recommence.',
  OAUTH_DENIED: 'Connexion annulée.',
  OAUTH_FAILED: 'Le fournisseur n\'a pas répondu correctement : réessaie.',
  PROVIDER_DISABLED: 'Ce fournisseur n\'est pas configuré sur ce serveur.',
  NOT_A_LOGIN_METHOD: 'Ce fournisseur ne permet pas de se connecter.',
  IDENTITY_TAKEN: 'Ce compte externe est déjà lié à un autre compte TuneGuess.',
  PROVIDER_ALREADY_LINKED: 'Un autre compte de ce fournisseur est déjà lié : déconnecte-le d\'abord.',
  ACCOUNT_DISABLED: 'Ce compte est désactivé.',
  RATE_LIMITED: 'Trop de tentatives : réessaie dans quelques minutes.',
};
