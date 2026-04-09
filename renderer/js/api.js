/**
 * CapForge API client — REST + WebSocket communication with the Python backend.
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

  /**
   * Normalize FastAPI error responses. The backend now returns structured
   * details like `{title, hint, raw}` for actionable errors; older endpoints
   * return a plain string. We produce an Error whose `.message` is suitable
   * for a toast ("<title> — <hint>") and attach the raw fields on the error
   * object for callers that want to show them separately.
   */
  async _handleError(res) {
    const fallback = { detail: res.statusText };
    const body = await res.json().catch(() => fallback);
    const detail = body.detail;
    const err = new Error();
    if (detail && typeof detail === "object" && detail.title) {
      err.title = detail.title;
      err.hint = detail.hint || "";
      err.raw = detail.raw || "";
      err.message = detail.hint ? `${detail.title} — ${detail.hint}` : detail.title;
    } else {
      err.message = typeof detail === "string" ? detail : res.statusText;
    }
    return err;
  }

  /** GET helper */
  async _get(path) {
    const res = await fetch(`${this.base}${path}`);
    if (!res.ok) throw await this._handleError(res);
    return res.json();
  }

  /** POST helper */
  async _post(path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this._handleError(res);
    return res.json();
  }

  /** PUT helper */
  async _put(path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this._handleError(res);
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

  updateResult(result) {
    return this._put("/api/result", result);
  }

  exportResult(params) {
    return this._post("/api/export", params);
  }

  renderVideo(params) {
    return this._post("/api/render-video", params);
  }

  /** Cancel the running job — transcription OR video render. */
  cancelJob() {
    return this._post("/api/cancel", {});
  }

  /** @deprecated use cancelJob() — kept for callers still using the old name. */
  cancelTranscription() {
    return this.cancelJob();
  }

  /** Get URL to stream an audio file through the backend. */
  audioUrl(filePath) {
    return `${this.base}/api/serve-audio?path=${encodeURIComponent(filePath)}`;
  }

  /** Get video width, height, fps via ffprobe. Returns null fields on failure. */
  getVideoInfo(filePath) {
    return this._get(`/api/video-info?path=${encodeURIComponent(filePath)}`);
  }

  // --- WebSocket ---

  /** Connect to the progress WebSocket. Calls onProgress(update) on each message.
   *  Reconnects automatically with exponential backoff (1s → 2s → 4s … up to 30s). */
  connectProgress(onProgress) {
    this._onProgress = onProgress;
    this._wsReconnectDelay = this._wsReconnectDelay || 1000;
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null; }
    if (this.ws) {
      this.ws.onclose = null; // prevent the old socket triggering another reconnect
      this.ws.close();
    }
    this.ws = new WebSocket(`${this.wsBase}/ws/progress`);

    this.ws.onopen = () => {
      this._wsReconnectDelay = 1000; // reset backoff on successful connection
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (this._onProgress) this._onProgress(data);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      if (!this._onProgress) return; // intentionally disconnected
      const delay = this._wsReconnectDelay;
      this._wsReconnectDelay = Math.min(delay * 2, 30000); // cap at 30s
      this._wsReconnectTimer = setTimeout(() => {
        if (this._onProgress) this.connectProgress(this._onProgress);
      }, delay);
    };

    this.ws.onerror = () => {
      // Will trigger onclose → reconnect
    };
  }

  disconnectProgress() {
    this._onProgress = null;
    this._wsReconnectDelay = 1000;
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null; }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

// Global instance
const api = new SubForgeAPI();
