const BASE_URL = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
const STORAGE_KEY = 'tuneguess_admin_password';

function getStoredPassword() {
  return sessionStorage.getItem(STORAGE_KEY) || '';
}

function setStoredPassword(password) {
  sessionStorage.setItem(STORAGE_KEY, password);
}

function clearStoredPassword() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function getAuthHeaders() {
  const password = getStoredPassword();
  if (!password) return {};
  return { Authorization: `Bearer ${password}` };
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
    ...getAuthHeaders(),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      payload = { error: text };
    }
    const error = new Error(payload?.error || response.statusText || 'Erreur réseau');
    Object.assign(error, { status: response.status, data: payload });
    throw error;
  }

  return response.json();
}

export function isAdminAuthenticated() {
  return Boolean(getStoredPassword());
}

export function setAdminPassword(password) {
  setStoredPassword(password);
}

export function logoutAdmin() {
  clearStoredPassword();
}

export async function fetchAdminRooms() {
  return request('/admin/rooms');
}

export async function fetchAdminRoom(roomId) {
  return request(`/admin/rooms/${encodeURIComponent(roomId)}`);
}

export async function renameAdminPlayer(roomId, playerId, name) {
  return request(`/admin/rooms/${encodeURIComponent(roomId)}/players/${encodeURIComponent(playerId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function kickAdminPlayer(roomId, playerId) {
  return request(`/admin/rooms/${encodeURIComponent(roomId)}/players/${encodeURIComponent(playerId)}/kick`, {
    method: 'POST',
  });
}

export async function deleteAdminRoom(roomId) {
  return request(`/admin/rooms/${encodeURIComponent(roomId)}`, {
    method: 'DELETE',
  });
}
