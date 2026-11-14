import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import axios from 'axios';

// Jamais joignables, même avec JELLYFIN_ALLOW_PRIVATE_NETWORK (métadonnées cloud, adresses non routables).
const ALWAYS_BLOCKED = new net.BlockList();
ALWAYS_BLOCKED.addSubnet('0.0.0.0', 8);
ALWAYS_BLOCKED.addSubnet('169.254.0.0', 16);
ALWAYS_BLOCKED.addSubnet('224.0.0.0', 3);
ALWAYS_BLOCKED.addAddress('::', 'ipv6');
ALWAYS_BLOCKED.addSubnet('fe80::', 10, 'ipv6');
ALWAYS_BLOCKED.addSubnet('ff00::', 8, 'ipv6');

// Réseaux locaux : refusés par défaut, autorisables pour un Jellyfin auto-hébergé sur le LAN.
const PRIVATE = new net.BlockList();
PRIVATE.addSubnet('10.0.0.0', 8); // plage RFC 1918 (scan:ok)
PRIVATE.addSubnet('100.64.0.0', 10);
PRIVATE.addSubnet('127.0.0.0', 8);
PRIVATE.addSubnet('172.16.0.0', 12); // plage RFC 1918 (scan:ok)
PRIVATE.addSubnet('192.168.0.0', 16); // plage RFC 1918 (scan:ok)
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');

const ipType = (ip: string) => (net.isIPv6(ip) ? 'ipv6' : 'ipv4');

export function isPrivateAddress(ip: string): boolean {
  return net.isIP(ip) !== 0 && PRIVATE.check(ip, ipType(ip));
}

export function isForbiddenTarget(ip: string): boolean {
  if (ALWAYS_BLOCKED.check(ip, ipType(ip))) return true;
  return process.env.JELLYFIN_ALLOW_PRIVATE_NETWORK !== 'true' && isPrivateAddress(ip);
}

function blockedError(host: string) {
  return Object.assign(new Error(`Destination interdite : ${host}`), { code: 'EADDRBLOCKED' });
}

/** Base http(s) d'un serveur fourni par l'utilisateur, sans identifiants, requête ni fragment. */
export function normalizeServerUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('URL de serveur invalide');
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('URL de serveur invalide');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

// Vérifie l'adresse réellement résolue, au moment de la connexion (pas de contournement par rebinding DNS).
const guardedLookup = ((hostname: string, options: dns.LookupOptions, callback: (...args: any[]) => void) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (addresses.length === 0 || addresses.some((a) => isForbiddenTarget(a.address))) {
      return callback(blockedError(hostname));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}) as net.LookupFunction;

/** Client HTTP pour les URL fournies par les utilisateurs (Jellyfin). */
export const outbound = axios.create({
  timeout: 10_000,
  maxRedirects: 0,
  proxy: false,
  httpAgent: new http.Agent({ lookup: guardedLookup }),
  httpsAgent: new https.Agent({ lookup: guardedLookup }),
});

// Une IP littérale ne passe pas par lookup : on la contrôle avant l'envoi.
outbound.interceptors.request.use((config) => {
  const url = new URL(config.url || '');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocole interdit');
  if (net.isIP(host) && isForbiddenTarget(host)) throw blockedError(host);
  return config;
});
