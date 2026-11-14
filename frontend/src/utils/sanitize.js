export const MAX_NAME_LENGTH = 20;

export function sanitizeInput(text, maxLen = MAX_NAME_LENGTH) {
  if (typeof text !== 'string') return '';
  return text.trim().slice(0, maxLen);
}
