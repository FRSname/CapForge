/**
 * SubForge — Main application logic.
 * Handles screens, file selection, settings, progress, and results.
 */

(function () {
  "use strict";

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

  // --- Init ---
  async function init() {
    // Get backend port from Electron
    if (window.subforge) {
      const port = await window.subforge.getBackendPort();
      api.setPort(port);
    }

    // Load system info + languages
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

    // Connect WebSocket for progress
    api.connectProgress(onProgressUpdate);

    // Bind events
    bindEvents();
  }

  // --- Screen management ---
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  // --- Hardware info ---
  function renderHardwareInfo(info) {
    if (info.has_cuda) {
      hwInfo.innerHTML = `<span class="hw-gpu">${info.gpu_name}</span><br/>` +
        `VRAM: ${info.vram_mb} MB · Model: ${info.recommended_model}<br/>` +
        `Compute: ${info.recommended_compute_type}`;
    } else {
      hwInfo.innerHTML = `<span class="hw-cpu">CPU mode</span><br/>` +
        `Model: ${info.recommended_model} · Compute: ${info.recommended_compute_type}`;
    }
  }

  // --- Languages ---
  function renderLanguages(langs) {
    // Keep the "Auto-detect" option
    Object.entries(langs)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .forEach(([code, name]) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${name} (${code})`;
        selLanguage.appendChild(opt);
      });
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
      if (file) setFile(file.path);
    });

    // File controls
    btnClearFile.addEventListener("click", clearFile);
    btnStart.addEventListener("click", startTranscription);
    btnCancel.addEventListener("click", () => {
      // Soft cancel — just go back to file screen (backend will finish in background)
      showScreen("file");
    });

    // Results
    btnExport.addEventListener("click", exportFiles);
    btnNew.addEventListener("click", () => {
      clearFile();
      transcriptionResult = null;
      showScreen("file");
    });

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
  }

  // --- File selection ---
  async function pickFile() {
    if (window.subforge) {
      const path = await window.subforge.pickAudioFile();
      if (path) setFile(path);
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

  // --- Transcription ---
  async function startTranscription() {
    if (!selectedFilePath) return;

    // Gather settings
    const language = selLanguage.value || null;
    const enableDiarization = chkDiarize.checked;
    const hfToken = enableDiarization ? inpHfToken.value.trim() || null : null;
    const formats = getSelectedFormats();

    // Switch to progress screen
    progressLog.textContent = "";
    progressBar.style.width = "0%";
    progressPct.textContent = "0%";
    stepIndicator.textContent = "Starting…";
    showScreen("progress");

    try {
      await api.startTranscription({
        audio_path: selectedFilePath,
        language: language,
        enable_diarization: enableDiarization,
        hf_token: hfToken,
        output_dir: outputDir,
        export_formats: formats,
      });

      // Fetch the result
      transcriptionResult = await api.getResult();
      renderResults(transcriptionResult);
      showScreen("results");
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
    const pct = Math.round(update.progress);
    progressBar.style.width = `${pct}%`;
    progressPct.textContent = `${pct}%`;
    stepIndicator.textContent = formatStatus(update.status);
    stepIndicator.style.color = update.status === "error" ? "var(--danger)" : "var(--accent)";
    if (update.message) appendLog(update.message);

    // Auto-switch to results when done
    if (update.status === "done" && pct >= 100) {
      api.getResult().then((result) => {
        transcriptionResult = result;
        renderResults(result);
        showScreen("results");
      }).catch(() => {});
    }
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

  // --- Results ---
  function renderResults(result) {
    if (!result || !result.segments) {
      resultsPreview.textContent = "No results.";
      return;
    }

    const lines = result.segments.map((seg) => {
      const time = formatTime(seg.start);
      const speaker = seg.speaker ? `[${seg.speaker}] ` : "";
      return `<div><span style="color:var(--text-muted)">${time}</span> ${speaker}${escapeHtml(seg.text)}</div>`;
    });
    resultsPreview.innerHTML = lines.join("");
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Export ---
  async function exportFiles() {
    const formats = getSelectedFormats();
    if (!formats.length) {
      alert("Select at least one export format in Settings.");
      return;
    }
    try {
      const res = await api.exportResult({
        formats: formats,
        output_dir: outputDir,
      });
      alert(`Exported ${res.files.length} file(s):\n\n${res.files.join("\n")}`);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  }

  // --- Boot ---
  init();
})();
