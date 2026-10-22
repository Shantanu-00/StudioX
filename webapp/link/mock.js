// mock.js — In-memory fake backend persisted in sessionStorage
// Simulates /v1/ API contract for local testing and demo mode (?mock=1)

const STORAGE_KEY = 'studiox_mock_session_v1';

function generateId(prefix = '01J') {
  const ts = Date.now().toString(36).toUpperCase().padStart(10, '0');
  const rnd = Math.random().toString(36).substring(2, 10).toUpperCase().padEnd(8, '0');
  return `${prefix}${ts}${rnd}`;
}

function getInitialState() {
  const now = Date.now();
  return {
    isPaired: true,
    tvName: 'LIVING ROOM TV',
    phoneName: 'My phone',
    linkId: 'link_01J_LIVING_ROOM',
    nowPlayingStartTime: now - 742000, // 12:22 into the episode
    mediaStore: {},
    messages: [
      {
        id: '01J00000000000000000000001',
        at: new Date(now - 1800000).toISOString(),
        from: { kind: 'system', name: 'SYSTEM' },
        kind: 'status',
        text: 'LINK ESTABLISHED',
        status: { state: 'LINK ESTABLISHED' }
      },
      {
        id: '01J00000000000000000000002',
        at: new Date(now - 1200000).toISOString(),
        from: { kind: 'tv', name: 'LIVING ROOM TV' },
        kind: 'share',
        text: 'Evening routine, as described',
        card: {
          type: 'checklist',
          title: 'Evening routine, as described',
          items: [
            { text: 'Magnesium L-threonate · 145 mg in the evening', time: '21:30' },
            { text: 'Apigenin · 50 mg', time: '21:30' },
            { text: 'Cool the room to 18 °C' },
            { text: 'Plan five 90-minute cycles' }
          ],
          hasTimes: true
        }
      },
      {
        id: '01J00000000000000000000003',
        at: new Date(now - 900000).toISOString(),
        from: { kind: 'tv', name: 'LIVING ROOM TV' },
        kind: 'share',
        text: 'Morning light, 10 min',
        card: {
          type: 'reminder',
          title: 'Morning light, 10 min',
          reminder: {
            title: 'Morning light, 10 min',
            start: '2026-10-23T07:30:00Z',
            repeat: 'daily'
          }
        }
      },
      {
        id: '01J00000000000000000000004',
        at: new Date(now - 600000).toISOString(),
        from: { kind: 'phone', name: 'My phone' },
        kind: 'question',
        text: 'What did he say about deep sleep?',
        t: 5.0
      },
      {
        id: '01J00000000000000000000005',
        at: new Date(now - 598500).toISOString(),
        from: { kind: 'ai', name: 'AI CO-VIEWER' },
        kind: 'answer',
        text: 'Deep sleep (stage 3 NREM) is critical for physical restoration and glymphatic clearance [0:05]. Growth hormone release peaks during this window.',
        card: {
          sources: [
            {
              title: 'Walker et al., Sleep Medicine Reviews',
              url: 'https://pubmed.ncbi.nlm.nih.gov/sleep-restoration'
            }
          ]
        }
      },
      // Additional cards demonstrating 'person', 'list', and 'link' types
      {
        id: '01J00000000000000000000006',
        at: new Date(now - 400000).toISOString(),
        from: { kind: 'tv', name: 'LIVING ROOM TV' },
        kind: 'share',
        text: 'Dr. Matthew Walker, Ph.D.',
        card: {
          type: 'person',
          title: 'Featured Guest',
          person: {
            name: 'Matthew Walker, Ph.D.',
            role: 'PROFESSOR OF NEUROSCIENCE, UC BERKELEY',
            imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
            credit: 'Center for Human Sleep Science',
            facts: [
              'Author of international bestseller "Why We Sleep"',
              'Pioneered research in sleep-dependent memory consolidation',
              'Advises NBA, NFL, and Olympic athletic teams'
            ]
          }
        }
      },
      {
        id: '01J00000000000000000000007',
        at: new Date(now - 200000).toISOString(),
        from: { kind: 'tv', name: 'LIVING ROOM TV' },
        kind: 'share',
        text: 'Biomarkers of Stage 3 Sleep',
        card: {
          type: 'list',
          title: 'Biomarkers of Stage 3 Sleep',
          items: [
            { name: 'Delta Wave Amplitude', detail: '> 75 microvolts at 0.5–2 Hz' },
            { name: 'Parasympathetic Tone', detail: 'Marked increase in HRV vagal metrics' },
            { name: 'Cerebral Blood Flow', detail: 'Shifts toward memory-indexing circuits' }
          ],
          sources: [
            { title: 'Journal of Neuroscience Research', url: 'https://onlinelibrary.wiley.com' }
          ]
        }
      }
    ]
  };
}

class MockBackend {
  constructor() {
    this.state = this.loadState();
  }

  loadState() {
    try {
      const serialized = sessionStorage.getItem(STORAGE_KEY);
      if (serialized) {
        return JSON.parse(serialized);
      }
    } catch (_) {}
    const initial = getInitialState();
    this.saveState(initial);
    return initial;
  }

  saveState(state = this.state) {
    this.state = state;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  reset() {
    this.state = getInitialState();
    this.saveState();
  }

  // --- /v1/pairings/{code}/redeem ---
  async redeemPairing(code, phoneName) {
    const cleanCode = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanCode === 'EXPIRE' || cleanCode === 'OLD000') {
      return {
        status: 410,
        data: { error: { code: 'EXPIRED', message: 'This code has expired. Show a new code on the TV.' } }
      };
    }
    if (cleanCode === 'USE409') {
      return {
        status: 409,
        data: { error: { code: 'ALREADY_USED', message: 'This code has already been redeemed.' } }
      };
    }
    if (cleanCode.length !== 6 && cleanCode !== 'EXPIRE' && cleanCode !== 'USE409') {
      return {
        status: 404,
        data: { error: { code: 'NOT_FOUND', message: 'Pairing code not found or expired.' } }
      };
    }

    this.state.isPaired = true;
    this.state.phoneName = (phoneName || 'My phone').trim().slice(0, 30);
    this.state.tvName = 'LIVING ROOM TV';
    this.state.linkId = 'link_01J_LIVING_ROOM';
    this.saveState();

    return {
      status: 200,
      data: {
        linkId: this.state.linkId,
        tvName: this.state.tvName
      }
    };
  }

  // --- GET /v1/me ---
  async getMe() {
    if (!this.state.isPaired) {
      return {
        status: 401,
        data: { error: { code: 'UNAUTHORIZED', message: 'Not paired' } }
      };
    }
    return {
      status: 200,
      data: {
        linkId: this.state.linkId || 'link_01J_LIVING_ROOM',
        phoneName: this.state.phoneName || 'My phone',
        tvName: this.state.tvName || 'LIVING ROOM TV'
      }
    };
  }

  // --- DELETE /v1/me ---
  async deleteMe() {
    this.state.isPaired = false;
    this.saveState();
    return {
      status: 204,
      data: null
    };
  }

  // --- GET /v1/links/{id}/now ---
  async getNow(linkId) {
    if (!this.state.isPaired) {
      return { status: 401, data: { error: { code: 'UNAUTHORIZED', message: 'Not paired' } } };
    }
    const elapsedSec = (Date.now() - (this.state.nowPlayingStartTime || Date.now())) / 1000;
    const currentT = 742.0 + (elapsedSec % 3600); // cycle or advance
    return {
      status: 200,
      data: {
        mediaId: 'med_sleep42',
        title: 'The science of sleep, ep. 42',
        t: Math.floor(currentT * 10) / 10,
        playing: true,
        updatedAt: new Date().toISOString()
      }
    };
  }

  // --- GET /v1/links/{id}/messages?after=<cursor> ---
  async getMessages(linkId, after) {
    if (!this.state.isPaired) {
      return { status: 401, data: { error: { code: 'UNAUTHORIZED', message: 'Not paired' } } };
    }
    // Reload state in case async replies or status updates were committed
    this.state = this.loadState();
    let msgs = this.state.messages || [];

    if (after) {
      const idx = msgs.findIndex((m) => m.id === after);
      if (idx !== -1) {
        msgs = msgs.slice(idx + 1);
      } else {
        msgs = msgs.filter((m) => m.id > after);
      }
    }

    const pageSize = 50;
    const slice = msgs.slice(0, pageSize);
    const cursor = slice.length > 0 ? slice[slice.length - 1].id : (after || null);

    return {
      status: 200,
      data: {
        messages: slice,
        cursor
      }
    };
  }

  // --- POST /v1/links/{id}/messages ---
  async postMessage(linkId, { kind, text }) {
    if (!this.state.isPaired) {
      return { status: 401, data: { error: { code: 'UNAUTHORIZED', message: 'Not paired' } } };
    }
    this.state = this.loadState();
    const elapsedSec = (Date.now() - (this.state.nowPlayingStartTime || Date.now())) / 1000;
    const currentT = 742.0 + (elapsedSec % 3600);

    const newMsg = {
      id: generateId('01J'),
      at: new Date().toISOString(),
      from: { kind: 'phone', name: this.state.phoneName || 'My phone' },
      kind: kind || 'text',
      text: (text || '').trim().slice(0, 2000)
    };

    if (kind === 'question') {
      newMsg.t = Math.floor(currentT * 10) / 10;
    }

    this.state.messages.push(newMsg);
    this.saveState();

    // If it is a question, simulate AI CO-VIEWER reply after 1.5s
    if (kind === 'question') {
      setTimeout(() => {
        const freshState = this.loadState();
        const mins = Math.floor(currentT / 60);
        const secs = Math.floor(currentT % 60).toString().padStart(2, '0');
        const tsFormatted = `[${mins}:${secs}]`;

        const aiMsg = {
          id: generateId('01J'),
          at: new Date().toISOString(),
          from: { kind: 'ai', name: 'AI CO-VIEWER' },
          kind: 'answer',
          text: `Regarding "${newMsg.text}": the podcast discussion at ${tsFormatted} highlights that peripheral vasodilation accelerates sleep onset by dispersing core temperature.`,
          card: {
            sources: [
              {
                title: 'Walker & Huberman, Physiological Sleep Dynamics',
                url: 'https://hubermanlab.com/toolkit-for-sleep'
              }
            ]
          }
        };
        freshState.messages.push(aiMsg);
        this.saveState(freshState);
      }, 1500);
    }

    return {
      status: 200,
      data: newMsg
    };
  }

  // --- POST /v1/uploads ---
  async postUploads({ name, size, type }) {
    const mediaId = 'med_' + Math.random().toString(36).substring(2, 9);
    const partSize = 16777216; // 16 MiB
    const partCount = Math.max(1, Math.ceil(size / partSize));

    const parts = [];
    const firstBatch = Math.min(4, partCount);
    for (let i = 1; i <= firstBatch; i++) {
      parts.push({ n: i, url: `mock://s3.local/upload/${mediaId}/part-${i}` });
    }

    this.state.mediaStore[mediaId] = {
      mediaId,
      name,
      size,
      type,
      partSize,
      partCount,
      status: 'UPLOADING',
      progress: 0
    };
    this.saveState();

    return {
      status: 200,
      data: { mediaId, partSize, parts }
    };
  }

  // --- POST /v1/uploads/{mediaId}/parts ---
  async postUploadParts(mediaId, { numbers }) {
    const parts = (numbers || []).map((n) => ({
      n,
      url: `mock://s3.local/upload/${mediaId}/part-${n}`
    }));
    return {
      status: 200,
      data: { parts }
    };
  }

  // --- POST /v1/uploads/{mediaId}/complete ---
  async postUploadComplete(mediaId, { parts }) {
    this.state = this.loadState();
    const media = this.state.mediaStore[mediaId] || { mediaId };
    media.status = 'PROCESSING';
    this.state.mediaStore[mediaId] = media;

    // Add initial PROCESSING status message into thread
    const statusMsg = {
      id: generateId('01J'),
      at: new Date().toISOString(),
      from: { kind: 'system', name: 'SYSTEM' },
      kind: 'status',
      text: 'PROCESSING ▍',
      mediaId,
      status: {
        mediaId,
        state: 'PROCESSING',
        progress: 0.1
      }
    };
    this.state.messages.push(statusMsg);
    this.saveState();

    // Simulate backend analysis sequence: PROCESSING -> ANALYSING 1/3 -> ANALYSING 3/3 -> READY TO WATCH (2s apart)
    this.runMockAnalysisPipeline(mediaId, statusMsg.id);

    return {
      status: 200,
      data: { mediaId, status: 'PROCESSING' }
    };
  }

  runMockAnalysisPipeline(mediaId, msgId) {
    const steps = [
      { delay: 2000, state: 'ANALYSING 1/3', text: 'ANALYSING 1/3', progress: 0.33 },
      { delay: 4000, state: 'ANALYSING 3/3', text: 'ANALYSING 3/3', progress: 0.9 },
      { delay: 6000, state: 'READY TO WATCH', text: 'READY TO WATCH', progress: 1.0 }
    ];

    steps.forEach((step) => {
      setTimeout(() => {
        const fresh = this.loadState();
        if (fresh.mediaStore[mediaId]) {
          fresh.mediaStore[mediaId].status = step.state;
          fresh.mediaStore[mediaId].progress = step.progress;
        }
        // Update in-place in messages or add status update
        const existing = fresh.messages.find((m) => m.id === msgId || (m.mediaId === mediaId && m.kind === 'status'));
        if (existing) {
          existing.text = step.text;
          existing.status = {
            mediaId,
            state: step.state,
            progress: step.progress
          };
        } else {
          fresh.messages.push({
            id: generateId('01J'),
            at: new Date().toISOString(),
            from: { kind: 'system', name: 'SYSTEM' },
            kind: 'status',
            text: step.text,
            mediaId,
            status: { mediaId, state: step.state, progress: step.progress }
          });
        }
        this.saveState(fresh);
      }, step.delay);
    });
  }

  // --- GET /v1/media/{mediaId} ---
  async getMedia(mediaId) {
    this.state = this.loadState();
    const media = this.state.mediaStore[mediaId];
    if (!media) {
      return {
        status: 404,
        data: { error: { code: 'NOT_FOUND', message: 'Media not found' } }
      };
    }
    return {
      status: 200,
      data: {
        mediaId: media.mediaId,
        title: media.name || 'Uploaded Video',
        status: media.status,
        progress: media.progress,
        playable: media.status === 'READY TO WATCH'
      }
    };
  }
}

export const mockBackend = new MockBackend();
