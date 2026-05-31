export const MAX_NAME_LENGTH = 20;

export function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeInput(text, maxLen = MAX_NAME_LENGTH) {
  if (typeof text !== 'string') return '';
  return text.trim().slice(0, maxLen);
}
