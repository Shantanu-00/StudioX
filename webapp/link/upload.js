// upload.js — Multipart S3 video upload manager with resume, concurrency limit & wake lock

import { api, isMockMode } from './api.js';

const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4 GiB
const DEFAULT_PART_SIZE = 16 * 1024 * 1024; // 16 MiB
const CONCURRENCY = 4;
const MAX_RETRIES = 3;

let activeWakeLock = null;
let currentController = null;

async function acquireWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      activeWakeLock = await navigator.wakeLock.request('screen');
      activeWakeLock.addEventListener('release', () => {
        activeWakeLock = null;
      });
    } catch (_) {}
  }
}

function releaseWakeLock() {
  if (activeWakeLock) {
    try {
      activeWakeLock.release().catch(() => {});
    } catch (_) {}
    activeWakeLock = null;
  }
}

function beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = 'Upload in progress. Are you sure you want to leave?';
  return e.returnValue;
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return (bytes / 1024).toFixed(0) + ' KB';
  return Math.round(mb) + ' MB';
}

function getResumeKey(file) {
  return `sx_resume_${encodeURIComponent(file.name)}_${file.size}`;
}

export class UploadManager {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onError = options.onError || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.isCancelled = false;
    this.mediaId = null;
  }

  cancel() {
    this.isCancelled = true;
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    releaseWakeLock();
    this.onStatus('CANCELLED');
  }

  async start(file) {
    if (!file) throw new Error('No file selected');

    // Validation
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('File exceeds 4 GiB limit');
    }
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name);
    if (!isVideo) {
      throw new Error('Selected file is not a valid video');
    }

    this.isCancelled = false;
    currentController = new AbortController();
    window.addEventListener('beforeunload', beforeUnloadHandler);
    await acquireWakeLock();

    try {
      const resumeKey = getResumeKey(file);
      let sessionData = null;
      try {
        const stored = sessionStorage.getItem(resumeKey);
        if (stored) sessionData = JSON.parse(stored);
      } catch (_) {}

      let mediaId;
      let partSize = DEFAULT_PART_SIZE;
      let partsList = [];
      const completedParts = (sessionData && sessionData.completedParts) ? sessionData.completedParts : {};

      if (sessionData && sessionData.mediaId) {
        mediaId = sessionData.mediaId;
        partSize = sessionData.partSize || DEFAULT_PART_SIZE;
        this.mediaId = mediaId;
        this.onStatus('RESUMING');
      } else {
        const initRes = await api.createUpload({
          name: file.name,
          size: file.size,
          type: file.type || 'video/mp4'
        });
        mediaId = initRes.mediaId;
        partSize = initRes.partSize || DEFAULT_PART_SIZE;
        partsList = initRes.parts || [];
        this.mediaId = mediaId;

        sessionStorage.setItem(resumeKey, JSON.stringify({
          mediaId,
          partSize,
          completedParts: {}
        }));
      }

      const totalParts = Math.max(1, Math.ceil(file.size / partSize));

      // In mock mode: run a high-fidelity mock progression over ~6 seconds
      if (isMockMode()) {
        await this.runMockUpload(file, mediaId, totalParts, resumeKey);
        return;
      }

      // Map of URLs by part number
      const urlMap = new Map();
      partsList.forEach((p) => urlMap.set(p.n, p.url));

      // Calculate already uploaded bytes
      let uploadedBytes = Object.keys(completedParts).length * partSize;
      if (uploadedBytes > file.size) uploadedBytes = file.size;

      const updateProgress = () => {
        const pct = Math.min(99, Math.round((uploadedBytes / file.size) * 100));
        const uploadedMb = formatBytes(uploadedBytes);
        const totalMb = formatBytes(file.size);
        this.onProgress({
          percent: pct,
          uploadedBytes,
          totalBytes: file.size,
          text: `UPLOADING ${pct}% · ${uploadedMb} / ${totalMb}`
        });
      };

      updateProgress();

      // Determine remaining part numbers to upload
      const pendingParts = [];
      for (let n = 1; n <= totalParts; n++) {
        if (!completedParts[n]) {
          pendingParts.push(n);
        }
      }

      // Concurrency worker queue
      let queueIndex = 0;
      const worker = async () => {
        while (queueIndex < pendingParts.length) {
          if (this.isCancelled) return;
          const partNum = pendingParts[queueIndex++];

          let putUrl = urlMap.get(partNum);
          if (!putUrl) {
            const partRes = await api.getUploadParts(mediaId, [partNum]);
            if (partRes.parts && partRes.parts[0]) {
              putUrl = partRes.parts[0].url;
              urlMap.set(partNum, putUrl);
            }
          }

          const startByte = (partNum - 1) * partSize;
          const endByte = Math.min(startByte + partSize, file.size);
          const chunk = file.slice(startByte, endByte);

          const etag = await this.uploadPartWithRetry(mediaId, partNum, chunk, putUrl, urlMap);
          if (this.isCancelled) return;

          completedParts[partNum] = etag;
          uploadedBytes += chunk.size;
          if (uploadedBytes > file.size) uploadedBytes = file.size;

          sessionStorage.setItem(resumeKey, JSON.stringify({
            mediaId,
            partSize,
            completedParts
          }));

          updateProgress();
        }
      };

      const workers = [];
      const numWorkers = Math.min(CONCURRENCY, pendingParts.length);
      for (let i = 0; i < numWorkers; i++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      if (this.isCancelled) return;

      // Complete upload
      const sortedParts = Object.keys(completedParts)
        .map((n) => ({ n: parseInt(n, 10), etag: completedParts[n] }))
        .sort((a, b) => a.n - b.n);

      this.onStatus('PROCESSING');
      await api.completeUpload(mediaId, sortedParts);
      sessionStorage.removeItem(resumeKey);

      this.onComplete({ mediaId });
    } catch (err) {
      if (!this.isCancelled) {
        this.onError(err);
      }
    } finally {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      releaseWakeLock();
      currentController = null;
    }
  }

  async uploadPartWithRetry(mediaId, partNum, chunk, putUrl, urlMap, attempt = 1) {
    if (this.isCancelled) throw new Error('Upload cancelled');

    try {
      // Direct S3 PUT: strictly NO auth header and NO credentials
      const res = await fetch(putUrl, {
        method: 'PUT',
        body: chunk,
        signal: currentController ? currentController.signal : undefined
      });

      // Handle presigned URL expiration (403)
      if (res.status === 403 && attempt <= MAX_RETRIES) {
        const fresh = await api.getUploadParts(mediaId, [partNum]);
        if (fresh.parts && fresh.parts[0]) {
          const freshUrl = fresh.parts[0].url;
          urlMap.set(partNum, freshUrl);
          return this.uploadPartWithRetry(mediaId, partNum, chunk, freshUrl, urlMap, attempt + 1);
        }
      }

      if (!res.ok) {
        throw new Error(`Part ${partNum} failed with status ${res.status}`);
      }

      const etag = res.headers.get('ETag');
      if (!etag) {
        throw new Error(`Missing ETag header on part ${partNum}`);
      }
      return etag;
    } catch (err) {
      if (this.isCancelled || (err && err.name === 'AbortError')) {
        throw err;
      }
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 500;
        await new Promise((r) => setTimeout(r, delay));
        return this.uploadPartWithRetry(mediaId, partNum, chunk, putUrl, urlMap, attempt + 1);
      }
      throw err;
    }
  }

  async runMockUpload(file, mediaId, totalParts, resumeKey) {
    const totalBytes = file.size;
    const durationMs = 6000;
    const intervalMs = 250;
    const steps = Math.floor(durationMs / intervalMs);
    let currentStep = 0;

    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        if (this.isCancelled) {
          clearInterval(interval);
          resolve();
          return;
        }

        currentStep++;
        const frac = Math.min(1.0, currentStep / steps);
        const uploadedBytes = Math.floor(frac * totalBytes);
        const pct = Math.min(99, Math.round(frac * 100));

        this.onProgress({
          percent: pct,
          uploadedBytes,
          totalBytes,
          text: `UPLOADING ${pct}% · ${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)}`
        });

        if (currentStep >= steps) {
          clearInterval(interval);
          if (this.isCancelled) return resolve();

          this.onStatus('PROCESSING');
          const mockParts = [];
          for (let i = 1; i <= totalParts; i++) {
            mockParts.push({ n: i, etag: `"${mediaId}-part-${i}"` });
          }

          try {
            await api.completeUpload(mediaId, mockParts);
            sessionStorage.removeItem(resumeKey);
            this.onComplete({ mediaId });
            resolve();
          } catch (e) {
            this.onError(e);
            reject(e);
          }
        }
      }, intervalMs);
    });
  }
}
