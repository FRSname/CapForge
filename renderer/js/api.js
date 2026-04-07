/**
 * SubForge API client — REST + WebSocket communication with the Python backend.
 */

class SubForgeAPI {
  constructor(port = 8000) {
    this.base = `http://127.0.0.1:${port}`;
    this.wsBase = `ws://127.0.0.1:${port}`;
    this.ws = null;
    this._onProgress = null;
  }

  /** Set the backend port (called after Electron IPC resolves). */
  setPort(port) {
    this.base = `http://127.0.0.1:${port}`;
    this.wsBase = `ws://127.0.0.1:${port}`;
  }

  /** GET helper */
  async _get(path) {
    const res = await fetch(`${this.base}${path}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  }

  /** POST helper */
  async _post(path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  }

  // --- REST endpoints ---

  getSystemInfo() {
    return this._get("/api/system-info");
  }

  getLanguages() {
    return this._get("/api/languages");
  }

  getModels() {
    return this._get("/api/models");
  }

  getStatus() {
    return this._get("/api/status");
  }

  getResult() {
    return this._get("/api/result");
  }

  startTranscription(params) {
    return this._post("/api/transcribe", params);
  }

  exportResult(params) {
    return this._post("/api/export", params);
  }

  cancelTranscription() {
    return this._post("/api/cancel", {});
  }

  /** Get URL to stream an audio file through the backend. */
  audioUrl(filePath) {
    return `${this.base}/api/serve-audio?path=${encodeURIComponent(filePath)}`;
  }

  // --- WebSocket ---

  /** Connect to the progress WebSocket. Calls onProgress(update) on each message. */
  connectProgress(onProgress) {
    this._onProgress = onProgress;
    if (this.ws) {
      this.ws.close();
    }
    this.ws = new WebSocket(`${this.wsBase}/ws/progress`);

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (this._onProgress) this._onProgress(data);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      // Auto-reconnect after 2s
      setTimeout(() => {
        if (this._onProgress) this.connectProgress(this._onProgress);
      }, 2000);
    };

    this.ws.onerror = () => {
      // Will trigger onclose → reconnect
    };
  }

  disconnectProgress() {
    this._onProgress = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Global instance
const api = new SubForgeAPI();
