/**
 * SubForge — Main application logic.
 * Handles screens, file selection, settings, progress, results, audio preview.
 */

(function () {
  "use strict";

  const ALLOWED_EXTENSIONS = ["mp3", "wav", "m4a", "flac", "mp4", "mkv", "ogg", "webm", "aac", "wma"];

  // --- DOM refs ---
  const screens = {
    file: document.getElementById("screen-file"),
    progress: document.getElementById("screen-progress"),
    results: document.getElementById("screen-results"),
  };

  const dropZone = document.getElementById("drop-zone");
  const fileInfo = document.getElementById("file-info");
  const fileName = document.getElementById("file-name");
  const btnClearFile = document.getElementById("btn-clear-file");
  const btnStart = document.getElementById("btn-start");

  const progressBar = document.getElementById("progress-bar");
  const progressPct = document.getElementById("progress-pct");
  const stepIndicator = document.getElementById("step-indicator");
  const progressLog = document.getElementById("progress-log");
  const btnCancel = document.getElementById("btn-cancel");

  const resultsPreview = document.getElementById("results-preview");
  const btnExport = document.getElementById("btn-export");
  const btnNew = document.getElementById("btn-new");
  const subtitleLive = document.getElementById("subtitle-live");
  const exportedFiles = document.getElementById("exported-files");
  const exportedList = document.getElementById("exported-list");
  const btnPlay = document.getElementById("btn-play");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");
  const playerTime = document.getElementById("player-time");

  const btnSettingsToggle = document.getElementById("btn-settings-toggle");
  const settingsPanel = document.getElementById("settings-panel");
  const selLanguage = document.getElementById("sel-language");
  const hwInfo = document.getElementById("hw-info");
  const chkDiarize = document.getElementById("chk-diarize");
  const inpHfToken = document.getElementById("inp-hf-token");
  const btnPickDir = document.getElementById("btn-pick-dir");
  const outputDirDisplay = document.getElementById("output-dir-display");

  // --- State ---
  let selectedFilePath = null;
  let outputDir = "output";
  let transcriptionResult = null;
  let wavesurfer = null;
  let currentScreen = "file";

  // --- Init ---
  async function init() {
    if (window.subforge) {
      const port = await window.subforge.getBackendPort();
      api.setPort(port);
    }

    try {
      const [sysInfo, langData] = await Promise.all([
        api.getSystemInfo(),
        api.getLanguages(),
      ]);
      renderHardwareInfo(sysInfo);
      renderLanguages(langData.languages);
    } catch (err) {
      hwInfo.textContent = "Backend not available";
      console.error("Init error:", err);
    }

    api.connectProgress(onProgressUpdate);
    bindEvents();
  }

  // --- Screen management ---
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    currentScreen = name;
  }

  // --- Hardware info ---
  function renderHardwareInfo(info) {
    if (info.has_cuda) {
      hwInfo.innerHTML = `<span class="hw-gpu">${escapeHtml(info.gpu_name)}</span><br/>` +
        `VRAM: ${info.vram_mb} MB · Model: ${escapeHtml(info.recommended_model)}<br/>` +
        `Compute: ${escapeHtml(info.recommended_compute_type)}`;
    } else {
      hwInfo.innerHTML = `<span class="hw-cpu">CPU mode</span><br/>` +
        `Model: ${escapeHtml(info.recommended_model)} · Compute: ${escapeHtml(info.recommended_compute_type)}`;
    }
  }

  // --- Languages ---
  function renderLanguages(langs) {
    Object.entries(langs)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .forEach(([code, name]) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${name} (${code})`;
        selLanguage.appendChild(opt);
      });
  }

  // --- File validation ---
  function isValidAudioFile(path) {
    const ext = path.split(".").pop().toLowerCase();
    return ALLOWED_EXTENSIONS.includes(ext);
  }

  // --- Events ---
  function bindEvents() {
    // Drop zone
    dropZone.addEventListener("click", pickFile);
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      const file = e.dataTransfer.files[0];
      if (file) {
        if (!isValidAudioFile(file.path)) {
          showToast("Unsupported file format. Use: " + ALLOWED_EXTENSIONS.join(", "));
          return;
        }
        setFile(file.path);
      }
    });

    // File controls
    btnClearFile.addEventListener("click", clearFile);
    btnStart.addEventListener("click", startTranscription);
    btnCancel.addEventListener("click", cancelJob);

    // Results
    btnExport.addEventListener("click", exportFiles);
    btnNew.addEventListener("click", () => {
      destroyWavesurfer();
      clearFile();
      transcriptionResult = null;
      showScreen("file");
    });

    // Audio player
    btnPlay.addEventListener("click", togglePlayPause);

    // Settings
    btnSettingsToggle.addEventListener("click", () => {
      settingsPanel.classList.toggle("open");
    });

    chkDiarize.addEventListener("change", () => {
      inpHfToken.classList.toggle("hidden", !chkDiarize.checked);
    });

    btnPickDir.addEventListener("click", async () => {
      if (window.subforge) {
        const dir = await window.subforge.pickOutputDir();
        if (dir) {
          outputDir = dir;
          outputDirDisplay.textContent = dir;
        }
      }
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", onKeyDown);
  }

  function onKeyDown(e) {
    // Ignore if typing in an input
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.key === "Enter" && currentScreen === "file" && selectedFilePath) {
      e.preventDefault();
      startTranscription();
    } else if (e.key === "Escape" && currentScreen === "progress") {
      e.preventDefault();
      cancelJob();
    } else if (e.key === " " && currentScreen === "results" && wavesurfer) {
      e.preventDefault();
      togglePlayPause();
    }
  }

  // --- File selection ---
  async function pickFile() {
    if (window.subforge) {
      const path = await window.subforge.pickAudioFile();
      if (path) {
        if (!isValidAudioFile(path)) {
          showToast("Unsupported file format.");
          return;
        }
        setFile(path);
      }
    }
  }

  function setFile(path) {
    selectedFilePath = path;
    const name = path.split(/[\\/]/).pop();
    fileName.textContent = name;
    dropZone.classList.add("hidden");
    fileInfo.classList.remove("hidden");
  }

  function clearFile() {
    selectedFilePath = null;
    fileName.textContent = "-";
    dropZone.classList.remove("hidden");
    fileInfo.classList.add("hidden");
  }

  // --- Cancel ---
  async function cancelJob() {
    try {
      await api.cancelTranscription();
    } catch { /* ignore */ }
    showScreen("file");
  }

  // --- Transcription ---
  async function startTranscription() {
    if (!selectedFilePath) return;

    const language = selLanguage.value || null;
    const enableDiarization = chkDiarize.checked;
    const hfToken = enableDiarization ? inpHfToken.value.trim() || null : null;
    const formats = getSelectedFormats();

    // Reset progress UI
    progressLog.textContent = "";
    progressBar.style.width = "0%";
    progressPct.textContent = "0%";
    stepIndicator.textContent = "Starting…";
    stepIndicator.style.color = "var(--accent)";
    showScreen("progress");

    try {
      const response = await api.startTranscription({
        audio_path: selectedFilePath,
        language: language,
        enable_diarization: enableDiarization,
        hf_token: hfToken,
        output_dir: outputDir,
        export_formats: formats,
      });

      // The transcribe endpoint now returns the result directly
      if (response && response.segments) {
        transcriptionResult = response;
        showResults(response, response.exported_files);
      }
    } catch (err) {
      appendLog(`ERROR: ${err.message}`);
      stepIndicator.textContent = "Error";
      stepIndicator.style.color = "var(--danger)";
    }
  }

  function getSelectedFormats() {
    const checkboxes = document.querySelectorAll(".checkbox-group input:checked");
    return Array.from(checkboxes).map((cb) => cb.value);
  }

  // --- Progress updates (from WebSocket) ---
  function onProgressUpdate(update) {
    if (currentScreen !== "progress") return;

    const pct = Math.round(update.progress);
    progressBar.style.width = `${pct}%`;
    progressPct.textContent = `${pct}%`;
    stepIndicator.textContent = formatStatus(update.status);
    stepIndicator.style.color = update.status === "error" ? "var(--danger)" : "var(--accent)";
    if (update.message) appendLog(update.message);
  }

  function formatStatus(status) {
    const map = {
      idle: "Ready",
      loading_model: "Loading model…",
      transcribing: "Transcribing…",
      aligning: "Aligning words…",
      diarizing: "Identifying speakers…",
      exporting: "Exporting files…",
      done: "Complete!",
      error: "Error",
    };
    return map[status] || status;
  }

  function appendLog(msg) {
    progressLog.textContent += msg + "\n";
    progressLog.scrollTop = progressLog.scrollHeight;
  }

  // --- Show results with audio player ---
  function showResults(result, exportedPaths) {
    renderResults(result);
    initAudioPlayer();
    renderExportedFiles(exportedPaths);
    showScreen("results");
  }

  // --- Results ---
  function renderResults(result) {
    if (!result || !result.segments) {
      resultsPreview.textContent = "No results.";
      return;
    }

    resultsPreview.innerHTML = "";
    result.segments.forEach((seg, idx) => {
      const div = document.createElement("div");
      div.className = "segment-row";
      div.dataset.index = idx;
      div.dataset.start = seg.start;
      div.dataset.end = seg.end;

      const time = document.createElement("span");
      time.className = "segment-time";
      time.textContent = formatTime(seg.start);

      const text = document.createElement("span");
      text.className = "segment-text";

      // Build word-level spans if available
      if (seg.words && seg.words.length > 0) {
        seg.words.forEach((w) => {
          const span = document.createElement("span");
          span.className = "word";
          span.dataset.start = w.start;
          span.dataset.end = w.end;
          span.textContent = w.word + " ";
          span.addEventListener("click", () => seekTo(w.start));
          text.appendChild(span);
        });
      } else {
        text.textContent = seg.text;
      }

      const speaker = seg.speaker ? `[${escapeHtml(seg.speaker)}] ` : "";
      if (speaker) {
        const sp = document.createElement("span");
        sp.className = "segment-speaker";
        sp.textContent = speaker;
        div.appendChild(sp);
      }

      div.appendChild(time);
      div.appendChild(text);

      // Click segment timestamp to seek
      time.addEventListener("click", () => seekTo(seg.start));

      resultsPreview.appendChild(div);
    });
  }

  function renderExportedFiles(files) {
    if (!files || files.length === 0) {
      exportedFiles.classList.add("hidden");
      return;
    }
    exportedList.innerHTML = "";
    files.forEach((f) => {
      const li = document.createElement("li");
      li.textContent = f;
      exportedList.appendChild(li);
    });
    exportedFiles.classList.remove("hidden");
  }

  // --- Audio player ---
  function initAudioPlayer() {
    destroyWavesurfer();

    if (!selectedFilePath) return;

    const audioSrc = api.audioUrl(selectedFilePath);

    wavesurfer = WaveSurfer.create({
      container: "#waveform",
      waveColor: "#30363d",
      progressColor: "#58a6ff",
      cursorColor: "#58a6ff",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 60,
      responsive: true,
      backend: "WebAudio",
      url: audioSrc,
    });

    wavesurfer.on("play", () => {
      iconPlay.classList.add("hidden");
      iconPause.classList.remove("hidden");
    });

    wavesurfer.on("pause", () => {
      iconPlay.classList.remove("hidden");
      iconPause.classList.add("hidden");
    });

    wavesurfer.on("timeupdate", (currentTime) => {
      updatePlayerTime(currentTime, wavesurfer.getDuration());
      highlightCurrentSubtitle(currentTime);
    });

    wavesurfer.on("ready", () => {
      updatePlayerTime(0, wavesurfer.getDuration());
    });
  }

  function destroyWavesurfer() {
    if (wavesurfer) {
      wavesurfer.destroy();
      wavesurfer = null;
    }
    iconPlay.classList.remove("hidden");
    iconPause.classList.add("hidden");
    playerTime.textContent = "00:00 / 00:00";
    subtitleLive.textContent = "";
  }

  function togglePlayPause() {
    if (wavesurfer) wavesurfer.playPause();
  }

  function seekTo(time) {
    if (wavesurfer && wavesurfer.getDuration() > 0) {
      wavesurfer.seekTo(time / wavesurfer.getDuration());
      wavesurfer.play();
    }
  }

  function updatePlayerTime(current, duration) {
    playerTime.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
  }

  // --- Subtitle sync ---
  function highlightCurrentSubtitle(currentTime) {
    if (!transcriptionResult || !transcriptionResult.segments) return;

    // Find current segment
    let currentText = "";
    for (const seg of transcriptionResult.segments) {
      if (currentTime >= seg.start && currentTime <= seg.end) {
        currentText = seg.text;
        break;
      }
    }
    subtitleLive.textContent = currentText;

    // Highlight active words in preview
    const words = resultsPreview.querySelectorAll(".word");
    words.forEach((w) => {
      const ws = parseFloat(w.dataset.start);
      const we = parseFloat(w.dataset.end);
      w.classList.toggle("word-active", currentTime >= ws && currentTime <= we);
    });

    // Highlight active segment row
    const rows = resultsPreview.querySelectorAll(".segment-row");
    rows.forEach((row) => {
      const rs = parseFloat(row.dataset.start);
      const re = parseFloat(row.dataset.end);
      row.classList.toggle("segment-active", currentTime >= rs && currentTime <= re);
    });
  }

  // --- Utilities ---
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function showToast(message) {
    // Simple toast notification
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("toast-visible");
    setTimeout(() => toast.classList.remove("toast-visible"), 3000);
  }

  // --- Export ---
  async function exportFiles() {
    const formats = getSelectedFormats();
    if (!formats.length) {
      showToast("Select at least one export format in Settings.");
      return;
    }
    btnExport.disabled = true;
    btnExport.textContent = "Exporting…";
    try {
      const res = await api.exportResult({
        formats: formats,
        output_dir: outputDir,
      });
      renderExportedFiles(res.files);
      showToast(`Exported ${res.files.length} file(s)`);
    } catch (err) {
      showToast(`Export failed: ${err.message}`);
    } finally {
      btnExport.disabled = false;
      btnExport.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14ZM7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06Z"/></svg> Export Files`;
    }
  }

  // --- Boot ---
  init();
})();
