import { defineStore } from 'pinia';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from '@/services/account';

export const useAccountStore = defineStore('account', {
  state: () => ({
    user: null,
    adminAccess: null,
    providers: { google: false, youtube: false, lastfm: false, lastfmAuth: false, jellyfin: false },
    loaded: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.user,
    isAdmin: (s) => s.user?.role === 'admin',
    handle: (s) => (s.user?.username ? `@${s.user.username}` : ''),
  },
  actions: {
    async load() {
      try {
        const [me, providers] = await Promise.all([api('/api/me'), api('/api/config/fournisseurs')]);
        this.user = me.user;
        this.adminAccess = me.admin ?? null;
        this.providers = providers;
      } catch {
        this.user = null;
      }
      this.loaded = true;
    },
    async ensureLoaded() {
      if (!this.loaded) await this.load();
    },
    setUser(user) {
      this.user = user;
    },
    async logout() {
      await api('/api/compte/deconnexion', { method: 'POST', body: {} }).catch(() => {});
      this.user = null;
      this.adminAccess = null;
      // L'identité du socket est fixée à la connexion : sans rechargement, la partie s'enregistrerait encore sur ce compte.
      window.location.assign('/');
    },
    /** Connexion par passkey (découvrable : le navigateur propose les passkeys du site). */
    async loginWithPasskey() {
      const { challengeId, options } = await api('/api/passkey/options', { method: 'POST', body: {} });
      const response = await startAuthentication({ optionsJSON: options });
      const { user } = await api('/api/passkey/connexion', { method: 'POST', body: { challengeId, response } });
      this.user = user;
      await this.load();
    },
    async registerPasskey(name) {
      const { challengeId, options } = await api('/api/compte/passkeys/options', { method: 'POST', body: {} });
      const response = await startRegistration({ optionsJSON: options });
      const { user } = await api('/api/compte/passkeys', { method: 'POST', body: { challengeId, response, name } });
      this.user = user;
      await this.load();
    },
    /** Enrôlement d'un promu : code remis par l'admin + passkey créée maintenant ; le rôle admin s'active ensuite. */
    async enrollAdmin(code, name) {
      const { challengeId, options } = await api('/api/compte/enrolement-admin/options', { method: 'POST', body: { code } });
      const response = await startRegistration({ optionsJSON: options });
      const { user } = await api('/api/compte/enrolement-admin', { method: 'POST', body: { code, challengeId, response, name } });
      this.user = user;
      await this.load();
    },
    /** Assertion fraîche pour l'accès admin hors Tailscale (12 h, liée à la session). */
    async elevate() {
      const { challengeId, options } = await api('/api/compte/elevation/options', { method: 'POST', body: {} });
      const response = await startAuthentication({ optionsJSON: options });
      await api('/api/compte/elevation', { method: 'POST', body: { challengeId, response } });
      await this.load();
    },
  },
});
