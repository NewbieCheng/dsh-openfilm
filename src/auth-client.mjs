/** Browser-side helper: talk to Host auth bridge. Tokens never come back. */

const DESKTOP = typeof window !== 'undefined' && ['dsh-app:', 'app:'].includes(window.location.protocol);
const AUTH_URL = DESKTOP ? 'http://127.0.0.1:47821/api/auth' : '/api/no996-openfilm/auth';

export function authEndpoint() {
  return AUTH_URL;
}

export async function authAction(action, fields = {}, signal) {
  const surface = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : '';
  const response = await fetch(AUTH_URL, {
    method: 'POST',
    credentials: DESKTOP ? 'omit' : 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(DESKTOP ? {} : { 'x-no996-surface': surface }),
    },
    body: JSON.stringify({ action, ...fields }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.message || data?.error || `HTTP ${response.status}`));
    error.code = String(data?.error || 'AUTH');
    error.status = response.status;
    error.details = data?.details;
    throw error;
  }
  return data;
}
