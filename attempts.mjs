export const ATTEMPT_LIMIT = 3;
export const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const PREFIX = 'gajwa-snake-attempts-v1:';
const SALT_KEY = 'gajwa-snake-attempts-salt-v1';
// Browser-local, salted identity hash: never keep student names/IDs in persistent quota keys.
export async function attemptKey(profile, storage = localStorage, cryptoApi = crypto) {
  let salt = storage.getItem(SALT_KEY);
  if (!salt) {
    storage.setItem(SALT_KEY, cryptoApi.randomUUID());
    salt = storage.getItem(SALT_KEY);
  }
  if (!salt || !cryptoApi.subtle) throw new Error('quota storage unavailable');
  const raw = new TextEncoder().encode(salt + ':' + String(profile.studentId) + ':' + String(profile.name).trim().normalize('NFC'));
  const digest = await cryptoApi.subtle.digest('SHA-256', raw);
  return PREFIX + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function activeAttempts(raw, now = Date.now()) {
  let values;
  try { values = JSON.parse(raw || '[]'); } catch { values = []; }
  if (!Array.isArray(values)) return [];
  return values.filter(t => Number.isSafeInteger(t) && t <= now && t > now - ATTEMPT_WINDOW_MS).sort((a,b) => a-b).slice(-ATTEMPT_LIMIT);
}
export function quotaStatus(storage, key, now = Date.now()) {
  const attempts = activeAttempts(storage.getItem(key), now);
  return {remaining: Math.max(0, ATTEMPT_LIMIT - attempts.length), resetAt: attempts.length ? attempts[0] + ATTEMPT_WINDOW_MS : null};
}
export function consumeAttempt(storage, key, now = Date.now()) {
  const attempts = activeAttempts(storage.getItem(key), now);
  if (attempts.length >= ATTEMPT_LIMIT) return {allowed:false, remaining:0, resetAt:attempts[0] + ATTEMPT_WINDOW_MS};
  attempts.push(now);
  storage.setItem(key, JSON.stringify(attempts));
  const checked = quotaStatus(storage, key, now);
  if (checked.remaining !== ATTEMPT_LIMIT - attempts.length) throw new Error('quota storage verification failed');
  return {allowed:true, ...checked};
}
