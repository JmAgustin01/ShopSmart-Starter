const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function request(path, { timeoutMs, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      // Send the HttpOnly sign-in cookie. The page's JavaScript never sees the token itself.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      // Optional client-side limit so the page never waits forever.
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
    });
  } catch (caught) {
    const timedOut = caught?.name === 'TimeoutError' || caught?.name === 'AbortError';
    const error = new Error(timedOut
      ? 'ShopSmart took too long to answer. Please try again.'
      : 'Could not reach the ShopSmart API. Check that the backend is running.');
    error.code = timedOut ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR';
    throw error;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message || `Request failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.error?.code;
    error.details = data?.error?.details; // field errors from validation (422), used by checkout
    throw error;
  }
  return data;
}

export const api = {
  getProducts: (query = '') => request(`/products${query ? `?search=${encodeURIComponent(query)}` : ''}`),
  getProduct: (id) => request(`/products/${id}`),
  createOrder: (order) => request('/orders', { method: 'POST', body: JSON.stringify(order) }),
  getMyOrders: () => request('/orders'),
  getOrder: (id) => request(`/orders/${id}`),
  register: (account) => request('/auth/register', { method: 'POST', body: JSON.stringify(account) }),
  login: (credentials) => request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  // The backend gives the AI provider about 8 s, then falls back to rules; 20 s covers that plus the database.
  askAssistant: (question) => request('/assistant/questions', {
    method: 'POST', body: JSON.stringify({ question }), timeoutMs: 20_000
  })
};
