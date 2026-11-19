import { api } from '@/services/account';

// Admin des salons : cookie de session d'un compte admin (passkey confirmée ou Tailscale validé).
const salon = (roomId) => `/api/admin/salons/${encodeURIComponent(roomId)}`;

export const fetchAdminRooms = () => api('/api/admin/salons');
export const fetchAdminRoom = (roomId) => api(salon(roomId));
export const renameAdminPlayer = (roomId, playerId, name) =>
  api(`${salon(roomId)}/players/${encodeURIComponent(playerId)}`, { method: 'PATCH', body: { name } });
export const kickAdminPlayer = (roomId, playerId) =>
  api(`${salon(roomId)}/players/${encodeURIComponent(playerId)}/kick`, { method: 'POST', body: {} });
export const deleteAdminRoom = (roomId) => api(salon(roomId), { method: 'DELETE' });
