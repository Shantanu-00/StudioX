// api.js — All network calls for /v1/ and mock mode router
// HttpOnly cookie auth: always credentials: 'same-origin'. No tokens stored in JS.

import { mockBackend } from './mock.js';

export function isMockMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mock') === '1') return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || `API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'UNKNOWN_ERROR';
  }
}

async function request(path, options = {}) {
  const url = path.startsWith('/') ? path : `/${path}`;
  const fetchOpts = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  };

  if (options.body) {
    fetchOpts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, fetchOpts);
  } catch (netErr) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network connection unavailable');
  }

  if (response.status === 204) {
    return null;
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (_) {}
  }

  if (!response.ok) {
    const errObj = (data && data.error) ? data.error : {};
    throw new ApiError(response.status, errObj.code || 'HTTP_' + response.status, errObj.message || response.statusText);
  }

  return data;
}

function handleMockResult(result) {
  if (result.status >= 200 && result.status < 300) {
    return result.data;
  }
  const err = (result.data && result.data.error) ? result.data.error : {};
  throw new ApiError(result.status, err.code || 'MOCK_ERROR', err.message || 'Error occurred in mock');
}

export const api = {
  async redeemPairing(code, phoneName) {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.redeemPairing(code, phoneName));
    }
    return request(`/v1/pairings/${encodeURIComponent(code)}/redeem`, {
      method: 'POST',
      body: { phoneName }
    });
  },

  async getMe() {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.getMe());
    }
    return request('/v1/me', { method: 'GET' });
  },

  async deleteMe() {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.deleteMe());
    }
    return request('/v1/me', { method: 'DELETE' });
  },

  async getMessages(linkId, after) {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.getMessages(linkId, after));
    }
    const q = after ? `?after=${encodeURIComponent(after)}` : '';
    return request(`/v1/links/${encodeURIComponent(linkId)}/messages${q}`, { method: 'GET' });
  },

  async postMessage(linkId, { kind, text }) {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.postMessage(linkId, { kind, text }));
    }
    return request(`/v1/links/${encodeURIComponent(linkId)}/messages`, {
      method: 'POST',
      body: { kind, text }
    });
  },

  async getNow(linkId) {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.getNow(linkId));
    }
    return request(`/v1/links/${encodeURIComponent(linkId)}/now`, { method: 'GET' });
  },

  async createUpload({ name, size, type }) {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.postUploads({ name, size, type }));
    }
    return request('/v1/uploads', {
      method: 'POST',
      body: { name, size, type }
    });
  },

  async getUploadParts(mediaId, numbers) {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.postUploadParts(mediaId, { numbers }));
    }
    return request(`/v1/uploads/${encodeURIComponent(mediaId)}/parts`, {
      method: 'POST',
      body: { numbers }
    });
  },

  async completeUpload(mediaId, parts) {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.postUploadComplete(mediaId, { parts }));
    }
    return request(`/v1/uploads/${encodeURIComponent(mediaId)}/complete`, {
      method: 'POST',
      body: { parts }
    });
  },

  async getMedia(mediaId) {
    if (isMockMode()) {
      return handleMockResult(await mockBackend.getMedia(mediaId));
    }
    return request(`/v1/media/${encodeURIComponent(mediaId)}`, { method: 'GET' });
  }
};
