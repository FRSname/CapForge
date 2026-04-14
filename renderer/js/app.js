/**
 * CapForge — Main application logic.
 * Handles screens, file selection, settings, progress, results, audio preview.
 */

(function () {
  "use strict";

  const ALLOWED_EXTENSIONS = ["mp3", "wav", "m4a", "flac", "mp4", "mkv", "ogg", "webm", "aac", "wma"];
  const VIDEO_EXTENSIONS = ["mp4", "mkv", "webm", "avi", "mov"];

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
  const btnQueueAdd  = document.getElementById("btn-queue-add");
  const btnQueueClear = document.getElementById("btn-queue-clear");
  const batchQueueEl = document.getElementById("batch-queue");
  const batchQueueList = document.getElementById("batch-queue-list");

  const progressBar = document.getElementById("progress-bar");
  const progressPct = document.getElementById("progress-pct");
  const stepIndicator = document.getElementById("step-indicator");
  const progressLog = document.getElementById("progress-log");
  const btnCancel = document.getElementById("btn-cancel");

  const resultsPreview = document.getElementById("results-preview");
  const btnExport = document.getElementById("btn-export");
  const btnNew = document.getElementById("btn-new");
  const btnProjectSave = document.getElementById("btn-project-save");
  const btnProjectOpen = document.getElementById("btn-project-open");

  const exportedFiles = document.getElementById("exported-files");
  const exportedList = document.getElementById("exported-list");
  const btnPlay = document.getElementById("btn-play");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");
  const playerTime = document.getElementById("player-time");
  let videoPlayer = document.getElementById("video-player");
  const audioPlayerContainer = document.getElementById("audio-player");
  const waveformContainer = document.getElementById("waveform");
  const subtitleOverlay = document.getElementById("subtitle-overlay");
  const subtitleOverlayCtx = subtitleOverlay ? subtitleOverlay.getContext("2d") : null;
  const timelineCanvas = document.getElementById("timeline-canvas");
  const timelineCtx = timelineCanvas ? timelineCanvas.getContext("2d") : null;
  const btnTlZoomIn  = document.getElementById("btn-tl-zoom-in");
  const btnTlZoomOut = document.getElementById("btn-tl-zoom-out");
  const btnTlFit     = document.getElementById("btn-tl-fit");
  const tlZoomLabel  = document.getElementById("tl-zoom-label");
  // Timeline viewport state — zoom=1 shows entire duration; scrollT shifts visible window
  let _tlZoom    = 1;
  let _tlScrollT = 0;
  const TL_ZOOM_MIN = 1;
  const TL_ZOOM_MAX = 200;

  const btnSettingsToggle = document.getElementById("btn-settings-toggle");
  const settingsPanel = document.getElementById("settings-panel");
  const selLanguage = document.getElementById("sel-language");
  const hwInfo = document.getElementById("hw-info");
  const chkDiarize = document.getElementById("chk-diarize");
  const inpHfToken = document.getElementById("inp-hf-token");
  const btnPickDir = document.getElementById("btn-pick-dir");
  const outputDirDisplay = document.getElementById("output-dir-display");

  // Edit mode
  const btnEditToggle = document.getElementById("btn-edit-toggle");
  const editActions = document.getElementById("edit-actions");
  const btnEditSave = document.getElementById("btn-edit-save");
  const btnEditDiscard = document.getElementById("btn-edit-discard");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const editStatus = document.getElementById("edit-status");

  // Group editor
  const btnGroupToggle = document.getElementById("btn-group-toggle");
  const inpTimingShift = document.getElementById("inp-timing-shift");
  const btnTimingShiftApply = document.getElementById("btn-timing-shift-apply");
  const groupEditorEl = document.getElementById("group-editor");
  const groupEditorList = document.getElementById("group-editor-list");
  const btnGroupReset = document.getElementById("btn-group-reset");

  // --- State ---
  let selectedFilePath = null;
  // Batch queue: [{path, name, status: "pending"|"active"|"done"|"error"}]
  let batchQueue = [];
  let batchRunning = false;
  let outputDir = "output";
  let transcriptionResult = null;
  let wavesurfer = null;
  let currentScreen = "file";
  let editMode = false;
  let hasEdits = false;
  // Undo/redo stacks — each entry is a JSON snapshot of transcriptionResult.segments
  const undoStack = [];
  const redoStack = [];
  let loopSegment = null; // { start, end } for loop-play in edit mode
  let groupEditorOpen = false;
  let customGroupsEdited = false; // true when user has manually modified groups
  let currentProjectPath = null; // path to the currently open .capforge file

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

    // Restore persisted HuggingFace token
    if (window.subforge && window.subforge.getState) {
      const savedToken = await window.subforge.getState("hfToken", null);
      if (savedToken && inpHfToken) inpHfToken.value = savedToken;
    }

    bindEvents();
  }

  // --- Screen management ---
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    currentScreen = name;
    // Show titlebar action buttons only on the results screen
    const show = name === "results";
    btnExport.classList.toggle("hidden", !show);
    btnNew.classList.toggle("hidden", !show);
    btnProjectSave.classList.toggle("hidden", !show);
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
    btnStart.addEventListener("click", () => {
      if (batchQueue.length > 1) {
        _runBatchQueue();
      } else {
        startTranscription();
      }
    });
    btnCancel.addEventListener("click", cancelJob);

    // Results
    btnExport.addEventListener("click", exportFiles);
    btnNew.addEventListener("click", () => {
      if (editMode) exitEditMode();
      destroyWavesurfer();
      clearFile();
      transcriptionResult = null;
      showScreen("file");
    });

    // Audio player
    btnPlay.addEventListener("click", togglePlayPause);

    // Edit mode
    btnEditToggle.addEventListener("click", toggleEditMode);
    btnEditSave.addEventListener("click", saveEdits);
    btnEditDiscard.addEventListener("click", discardEdits);

    // Settings
    btnSettingsToggle.addEventListener("click", () => {
      settingsPanel.classList.toggle("open");
    });

    // Theme toggle
    const btnThemeToggle  = document.getElementById("btn-theme-toggle");
    const themeToggleIcon  = document.getElementById("theme-toggle-icon");
    const themeToggleLabel = document.getElementById("theme-toggle-label");
    function applyTheme(isLight) {
      document.documentElement.classList.toggle("light", isLight);
      themeToggleIcon.textContent  = isLight ? "🌙" : "☀";
      themeToggleLabel.textContent = isLight ? "Dark Mode" : "Light Mode";
    }
    applyTheme(localStorage.getItem("capforge-theme") === "light");
    if (btnThemeToggle) {
      btnThemeToggle.addEventListener("click", () => {
        const isLight = !document.documentElement.classList.contains("light");
        applyTheme(isLight);
        localStorage.setItem("capforge-theme", isLight ? "light" : "dark");
      });
    }

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
    // Ctrl shortcuts work globally (even in inputs)
    if (e.key === "s" && e.ctrlKey && currentScreen === "results" && editMode) {
      e.preventDefault();
      saveEdits();
      return;
    } else if (e.key === "s" && e.ctrlKey && currentScreen === "results" && !editMode) {
      e.preventDefault();
      saveProject();
      return;
    } else if (e.key === "o" && e.ctrlKey) {
      e.preventDefault();
      openProject();
      return;
    }

    // Ignore other shortcuts if typing in an input or contenteditable
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;

    if (e.key === "Enter" && currentScreen === "file" && selectedFilePath) {
      e.preventDefault();
      startTranscription();
    } else if (e.key === "Escape" && currentScreen === "progress") {
      e.preventDefault();
      cancelJob();
    } else if (e.key === "Escape" && currentScreen === "results" && editMode) {
      e.preventDefault();
      discardEdits();
    } else if (e.key === " " && currentScreen === "results" && wavesurfer) {
      e.preventDefault();
      togglePlayPause();
    } else if (e.key === "e" && currentScreen === "results") {
      e.preventDefault();
      toggleEditMode();
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
    // Add as first queue item if not already there
    if (!batchQueue.some(i => i.path === path)) {
      batchQueue.unshift({ path, name: path.split(/[\\/]/).pop(), status: "pending" });
    }
    const name = path.split(/[\\/]/).pop();
    fileName.textContent = name;
    dropZone.classList.add("hidden");
    fileInfo.classList.remove("hidden");

    // Auto-set output folder to the source file's directory
    const dir = path.replace(/[\\/][^\\/]+$/, "");
    if (dir) {
      outputDir = dir;
      if (outputDirDisplay) outputDirDisplay.textContent = dir;
    }

    // Auto-detect video resolution + fps (also re-applied in showResults once controls exist)
    if (isVideoFile(path)) {
      api.getVideoInfo(path).then((info) => {
        applyVideoInfo(info);
        updateQuickRenderState();
      }).catch(() => { updateQuickRenderState(); });
    } else {
      updateQuickRenderState();
    }
  }

  function clearFile() {
    selectedFilePath = null;
    batchQueue = [];
    batchRunning = false;
    fileName.textContent = "-";
    dropZone.classList.remove("hidden");
    fileInfo.classList.add("hidden");
    _renderBatchQueue();
    updateQuickRenderState();
  }

  // --- Batch queue helpers ---
  function _addToQueue(path) {
    if (batchQueue.some(item => item.path === path)) return; // no duplicates
    batchQueue.push({ path, name: path.split(/[\\/]/).pop(), status: "pending" });
    _renderBatchQueue();
  }

  function _renderBatchQueue() {
    if (!batchQueueList || !batchQueueEl) return;
    // Only show queue section when there are extra files beyond the primary
    if (batchQueue.length <= 1) {
      batchQueueEl.classList.add("hidden");
      return;
    }
    batchQueueEl.classList.remove("hidden");
    batchQueueList.innerHTML = "";
    batchQueue.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = `batch-queue-item${item.status !== "pending" ? " " + item.status : ""}`;
      const nameEl = document.createElement("span");
      nameEl.className = "batch-queue-item-name";
      nameEl.textContent = (i === 0 ? "★ " : "") + item.name;
      nameEl.title = item.path;
      const statusEl = document.createElement("span");
      statusEl.className = "batch-queue-item-status";
      statusEl.textContent = item.status === "pending" ? "queued"
        : item.status === "active" ? "processing…"
        : item.status === "done" ? "✓ done"
        : item.status === "error" ? "✕ error" : "";
      const removeBtn = document.createElement("button");
      removeBtn.className = "batch-queue-item-remove";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove from queue";
      removeBtn.addEventListener("click", () => {
        if (item.status === "active") return; // can't remove active
        batchQueue.splice(i, 1);
        if (batchQueue.length > 0 && i === 0) {
          // Promote new first item as primary
          setFile(batchQueue[0].path);
        } else if (batchQueue.length === 0) {
          clearFile();
        }
        _renderBatchQueue();
      });
      li.appendChild(nameEl);
      li.appendChild(statusEl);
      if (item.status !== "active") li.appendChild(removeBtn);
      batchQueueList.appendChild(li);
    });
  }

  async function _runBatchQueue() {
    if (batchRunning) return;
    batchRunning = true;
    for (let i = 0; i < batchQueue.length; i++) {
      const item = batchQueue[i];
      if (item.status === "done") continue;
      item.status = "active";
      selectedFilePath = item.path;
      _renderBatchQueue();
      try {
        await startTranscription();
        item.status = "done";
      } catch (err) {
        item.status = "error";
        showToast(`Queue item failed: ${item.name} — ${err.message}`, "error");
      }
      _renderBatchQueue();
    }
    batchRunning = false;
    const done = batchQueue.filter(i => i.status === "done").length;
    const total = batchQueue.length;
    showToast(`Batch complete: ${done}/${total} files processed`, done === total ? "success" : "error");
  }

  // Wire queue buttons in bindEvents — called after DOM is ready
  if (btnQueueAdd) {
    btnQueueAdd.addEventListener("click", async () => {
      if (!window.subforge) return;
      const path = await window.subforge.pickAudioFile();
      if (path && isValidAudioFile(path)) {
        _addToQueue(path);
      }
    });
  }
  if (btnQueueClear) {
    btnQueueClear.addEventListener("click", () => {
      batchQueue = batchQueue.filter(i => i.status === "active"); // keep active
      _renderBatchQueue();
    });
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
    // Persist token so user doesn't need to re-enter it each session
    if (hfToken && window.subforge && window.subforge.setState) {
      window.subforge.setState("hfToken", hfToken);
    }
    const formats = getSelectedFormats();

    // Reset progress UI
    progressLog.textContent = "";
    progressBar.style.width = "0%";
    progressPct.textContent = "0%";
    stepIndicator.textContent = "Starting…";
    stepIndicator.style.color = "var(--accent)";
    if (progressElapsed) progressElapsed.textContent = "";
    if (progressSubMessage) progressSubMessage.textContent = "Initializing transcription pipeline…";
    simCurrentPct = 0; simTargetPct = 0; simCeilingPct = 0;
    stopSimProgress();
    updatePipelineSteps("");
    startElapsedTimer();
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

      // Transcribe endpoint returns metadata; fetch full result separately
      if (response && response.status === "ok") {
        const fullResult = await api.getResult();
        transcriptionResult = fullResult;
        undoStack.length = 0; redoStack.length = 0; _updateUndoRedoUI();
        buildStudioGroups();
        showResults(fullResult, response.exported_files);
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
  const progressPipeline = document.getElementById("progress-pipeline");
  const progressElapsed = document.getElementById("progress-elapsed");
  const progressSubMessage = document.getElementById("progress-sub-message");
  let progressStartTime = null;
  let progressTimer = null;

  // Smooth progress simulation — fills the gap between sparse backend updates
  let simCurrentPct = 0;          // current displayed %
  let simTargetPct = 0;           // target % from last backend update
  let simCeilingPct = 0;          // max % we can simulate to (next step boundary)
  let simTimer = null;

  // Each step's expected progress range: [start, end]
  const STEP_RANGES = {
    loading_model: [0, 14],
    transcribing:  [15, 54],
    aligning:      [55, 77],
    diarizing:     [78, 94],
    exporting:     [95, 99],
  };

  function startSimProgress(realPct, status) {
    simTargetPct = realPct;
    // Set ceiling to the end of the current step's range
    const range = STEP_RANGES[status];
    simCeilingPct = range ? range[1] : realPct;

    if (simTimer) clearInterval(simTimer);
    simTimer = setInterval(() => {
      if (simCurrentPct < simTargetPct) {
        // Quickly catch up to real progress
        simCurrentPct = Math.min(simCurrentPct + 1, simTargetPct);
      } else if (simCurrentPct < simCeilingPct) {
        // Slowly creep toward ceiling to show activity
        simCurrentPct = Math.min(simCurrentPct + 0.15, simCeilingPct);
      }
      const display = Math.round(simCurrentPct);
      progressBar.style.width = `${display}%`;
      progressPct.textContent = `${display}%`;
    }, 300);
  }

  function stopSimProgress() {
    if (simTimer) { clearInterval(simTimer); simTimer = null; }
  }

  const PIPELINE_STEPS = ["loading_model", "transcribing", "aligning", "diarizing", "exporting"];

  function updatePipelineSteps(currentStatus) {
    if (!progressPipeline) return;
    const steps = progressPipeline.querySelectorAll(".pipeline-step");
    let reachedCurrent = false;

    steps.forEach((step) => {
      const stepName = step.dataset.step;
      step.classList.remove("step-done", "step-active", "step-skipped");

      if (stepName === currentStatus) {
        step.classList.add("step-active");
        reachedCurrent = true;
      } else if (!reachedCurrent) {
        // Before current = done
        step.classList.add("step-done");
      }
      // After current = no class (default dim state)
    });

    // Special: if done, mark all as done
    if (currentStatus === "done") {
      steps.forEach((step) => {
        step.classList.remove("step-active");
        step.classList.add("step-done");
      });
    }
  }

  function startElapsedTimer() {
    progressStartTime = Date.now();
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      if (!progressElapsed) return;
      const elapsed = Math.floor((Date.now() - progressStartTime) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      progressElapsed.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }, 1000);
  }

  function stopElapsedTimer() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  function onProgressUpdate(update) {
    // Forward render progress to studio
    if (update.status === "rendering" || update.status === "encoding") {
      onRenderProgress(update);
      return;
    }

    if (currentScreen !== "progress") return;

    const pct = Math.round(update.progress);

    // Drive the simulated progress toward real value
    simTargetPct = pct;
    startSimProgress(pct, update.status);

    stepIndicator.textContent = formatStatus(update.status);
    stepIndicator.style.color = update.status === "error" ? "var(--danger)" : "var(--accent)";

    // Show backend message as prominent sub-message
    if (progressSubMessage && update.message) {
      progressSubMessage.textContent = update.message;
    }
    if (update.message) appendLog(update.message);

    // Update pipeline stepper
    updatePipelineSteps(update.status);

    // Stop timer on completion
    if (update.status === "done" || update.status === "error") {
      stopElapsedTimer();
      stopSimProgress();
      // Snap to final value
      progressBar.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
      simCurrentPct = pct;
      if (progressSubMessage) {
        progressSubMessage.textContent = update.status === "done" ? "Transcription finished" : update.message || "";
      }
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
      rendering: "Rendering video…",
      encoding: "Encoding video…",
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
    // Re-apply auto-detected video info now that studio controls are visible
    if (selectedFilePath && isVideoFile(selectedFilePath)) {
      api.getVideoInfo(selectedFilePath).then((info) => {
        applyVideoInfo(info);
      }).catch(() => {});
    }
  }

  function applyVideoInfo(info) {
    if (!info || !info.width || !info.height) return;
    const sel = document.getElementById("studio-resolution");
    const fps = document.getElementById("studio-fps");
    if (sel) {
      const key = `${info.width}x${info.height}`;
      let found = false;
      for (const opt of sel.options) {
        if (opt.value === key) { sel.value = key; found = true; break; }
      }
      if (!found) {
        const prev = sel.querySelector("option[data-source]");
        if (prev) prev.remove();
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = `${info.width}×${info.height} (Source)`;
        opt.dataset.source = "1";
        sel.insertBefore(opt, sel.firstChild);
        sel.value = key;
      }
    }
    if (fps && info.fps) {
      let bestOpt = null, bestDiff = Infinity;
      for (const opt of fps.options) {
        const diff = Math.abs(parseFloat(opt.value) - info.fps);
        if (diff < bestDiff) { bestDiff = diff; bestOpt = opt; }
      }
      if (bestOpt) fps.value = bestOpt.value;
    }
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
          span.addEventListener("click", () => {
            if (!editMode) seekTo(w.start);
          });
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

      // Click segment timestamp to seek (or loop in edit mode)
      time.addEventListener("click", () => {
        if (editMode) {
          loopPlaySegment(seg.start, seg.end);
        } else {
          seekTo(seg.start);
        }
      });

      // --- Timing editor row (visible only in edit mode) ---
      const timingRow = document.createElement("div");
      timingRow.className = "segment-timing";

      const makeTimingInput = (value, dataAttr) => {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "timing-input";
        inp.dataset.timingFor = dataAttr;
        inp.value = formatTimePrecise(value);
        inp.addEventListener("focus", () => { if (!inp._undoPushed) { _pushUndo(); inp._undoPushed = true; } });
        inp.addEventListener("blur",  () => { inp._undoPushed = false; });
        inp.addEventListener("input", () => {
          const v = parseTimePrecise(inp.value);
          inp.classList.toggle("timing-invalid", isNaN(v));
          if (!isNaN(v)) {
            hasEdits = true;
            div.classList.add("segment-modified");
            editStatus.textContent = "Unsaved changes";
          }
        });
        return inp;
      };

      const grpStart = document.createElement("span");
      grpStart.className = "timing-group";
      const lblStart = document.createElement("label");
      lblStart.textContent = "Start";
      grpStart.appendChild(lblStart);
      grpStart.appendChild(makeTimingInput(seg.start, "seg-start"));

      const grpEnd = document.createElement("span");
      grpEnd.className = "timing-group";
      const lblEnd = document.createElement("label");
      lblEnd.textContent = "End";
      grpEnd.appendChild(lblEnd);
      grpEnd.appendChild(makeTimingInput(seg.end, "seg-end"));

      timingRow.appendChild(grpStart);
      timingRow.appendChild(grpEnd);

      // Expand button for word-level timing
      if (seg.words && seg.words.length > 1) {
        const btnExpand = document.createElement("button");
        btnExpand.className = "timing-expand-btn";
        btnExpand.textContent = "Words ▼";
        btnExpand.type = "button";
        timingRow.appendChild(btnExpand);

        const wordTimingContainer = document.createElement("div");
        wordTimingContainer.className = "timing-word-row";

        seg.words.forEach((w, wi) => {
          const item = document.createElement("div");
          item.className = "timing-word-item";
          item.dataset.wordIndex = wi;

          const lbl = document.createElement("span");
          lbl.className = "timing-word-label";
          lbl.textContent = w.word;
          item.appendChild(lbl);

          const gS = document.createElement("span");
          gS.className = "timing-group";
          const lS = document.createElement("label");
          lS.textContent = "S";
          gS.appendChild(lS);
          gS.appendChild(makeTimingInput(w.start, "word-start"));
          item.appendChild(gS);

          const gE = document.createElement("span");
          gE.className = "timing-group";
          const lE = document.createElement("label");
          lE.textContent = "E";
          gE.appendChild(lE);
          gE.appendChild(makeTimingInput(w.end, "word-end"));
          item.appendChild(gE);

          wordTimingContainer.appendChild(item);
        });

        div.appendChild(wordTimingContainer);

        btnExpand.addEventListener("click", () => {
          const expanded = wordTimingContainer.classList.toggle("expanded");
          btnExpand.textContent = expanded ? "Words ▲" : "Words ▼";
        });
      }

      div.appendChild(timingRow);

      // Split / Merge buttons (only visible in edit mode via CSS)
      const segActionsRow = document.createElement("div");
      segActionsRow.className = "segment-actions";

      const btnSplit = document.createElement("button");
      btnSplit.className = "seg-action-btn";
      btnSplit.textContent = "Split here";
      btnSplit.title = "Split this segment at the midpoint (or at cursor if text is focused)";
      btnSplit.addEventListener("click", () => {
        _pushUndo();
        const segs = transcriptionResult.segments;
        const si = parseInt(div.dataset.index, 10);
        const s = segs[si];
        // Find midpoint word or time midpoint
        const mid = Math.floor((s.words && s.words.length > 1) ? s.words.length / 2 : 1);
        if (s.words && s.words.length > 1) {
          const wordsA = s.words.slice(0, mid);
          const wordsB = s.words.slice(mid);
          const segA = { ...s, end: wordsA[wordsA.length - 1].end, text: wordsA.map(w => w.word).join(" "), words: wordsA };
          const segB = { ...s, start: wordsB[0].start, text: wordsB.map(w => w.word).join(" "), words: wordsB };
          segs.splice(si, 1, segA, segB);
        } else {
          // No word-level data — split by time midpoint
          const midT = (s.start + s.end) / 2;
          const segA = { ...s, end: midT, words: [] };
          const segB = { ...s, start: midT, words: [] };
          segs.splice(si, 1, segA, segB);
        }
        hasEdits = true;
        renderResults(transcriptionResult);
        buildStudioGroups(); renderGroupEditor(); drawStudioFrame();
        editStatus.textContent = "Unsaved changes";
      });

      const btnMergeNext = document.createElement("button");
      btnMergeNext.className = "seg-action-btn";
      btnMergeNext.textContent = "Merge with next";
      btnMergeNext.title = "Merge this segment with the following one";
      btnMergeNext.addEventListener("click", () => {
        const segs = transcriptionResult.segments;
        const si = parseInt(div.dataset.index, 10);
        if (si >= segs.length - 1) return;
        _pushUndo();
        const sA = segs[si];
        const sB = segs[si + 1];
        const merged = {
          ...sA,
          end:    sB.end,
          text:   sA.text.trimEnd() + " " + sB.text.trimStart(),
          words:  [...(sA.words || []), ...(sB.words || [])],
          speaker: sA.speaker || sB.speaker || null,
        };
        segs.splice(si, 2, merged);
        hasEdits = true;
        renderResults(transcriptionResult);
        buildStudioGroups(); renderGroupEditor(); drawStudioFrame();
        editStatus.textContent = "Unsaved changes";
      });

      segActionsRow.appendChild(btnSplit);
      segActionsRow.appendChild(btnMergeNext);
      div.appendChild(segActionsRow);

      resultsPreview.appendChild(div);
    });

    // Apply edit mode state if re-rendering while editing
    if (editMode) applyEditableState(true);
  }

  // --- Edit mode ---
  function toggleEditMode() {
    if (editMode) {
      if (hasEdits) {
        // Ask to save first? For now just exit
        exitEditMode();
      } else {
        exitEditMode();
      }
    } else {
      enterEditMode();
    }
  }

  function enterEditMode() {
    editMode = true;
    hasEdits = false;
    btnEditToggle.classList.add("active");
    editActions.classList.remove("hidden");
    editStatus.textContent = "";
    resultsPreview.classList.add("editing");
    applyEditableState(true);
  }

  function exitEditMode() {
    editMode = false;
    hasEdits = false;
    loopSegment = null;
    btnEditToggle.classList.remove("active");
    editActions.classList.add("hidden");
    editStatus.textContent = "";
    resultsPreview.classList.remove("editing");
    applyEditableState(false);
  }

  function applyEditableState(editable) {
    const texts = resultsPreview.querySelectorAll(".segment-text");
    texts.forEach((el) => {
      if (editable) {
        el.contentEditable = "true";
        el.spellcheck = true;
        el.addEventListener("input", onSegmentInput);
        el.addEventListener("keydown", onSegmentKeyDown);
      } else {
        el.contentEditable = "false";
        el.removeEventListener("input", onSegmentInput);
        el.removeEventListener("keydown", onSegmentKeyDown);
      }
    });
    // Clear modified indicators if leaving edit mode
    if (!editable) {
      resultsPreview.querySelectorAll(".segment-modified").forEach((r) => r.classList.remove("segment-modified"));
    }
  }

  // ---- Undo/redo helpers ----
  function _snapshotSegments() {
    return JSON.parse(JSON.stringify(transcriptionResult.segments));
  }
  function _pushUndo() {
    if (!transcriptionResult) return;
    undoStack.push(_snapshotSegments());
    if (undoStack.length > 50) undoStack.shift(); // cap history
    redoStack.length = 0; // new edit clears redo
    _updateUndoRedoUI();
  }
  function _updateUndoRedoUI() {
    if (btnUndo) btnUndo.disabled = undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
  }
  function _restoreSnapshot(snapshot) {
    transcriptionResult.segments = snapshot;
    renderResults(transcriptionResult);
    buildStudioGroups();
    renderGroupEditor();
    drawStudioFrame();
    hasEdits = true;
    editStatus.textContent = "Unsaved changes";
    _updateUndoRedoUI();
  }
  function performUndo() {
    if (undoStack.length === 0) return;
    redoStack.push(_snapshotSegments());
    _restoreSnapshot(undoStack.pop());
  }
  function performRedo() {
    if (redoStack.length === 0) return;
    undoStack.push(_snapshotSegments());
    _restoreSnapshot(redoStack.pop());
  }

  if (btnUndo) btnUndo.addEventListener("click", performUndo);
  if (btnRedo) btnRedo.addEventListener("click", performRedo);

  function onSegmentInput(e) {
    if (!e.target._undoPushed) {
      // Push snapshot on the first keystroke in a contiguous edit
      _pushUndo();
      e.target._undoPushed = true;
      e.target.addEventListener("blur", () => { e.target._undoPushed = false; }, { once: true });
    }
    hasEdits = true;
    const row = e.target.closest(".segment-row");
    if (row) row.classList.add("segment-modified");
    editStatus.textContent = "Unsaved changes";
  }

  function onSegmentKeyDown(e) {
    // Undo / Redo shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); performUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); performRedo(); return; }
    // Tab to next segment, Shift+Tab to prev
    if (e.key === "Tab") {
      e.preventDefault();
      const texts = Array.from(resultsPreview.querySelectorAll(".segment-text"));
      const current = texts.indexOf(e.target);
      const next = e.shiftKey ? current - 1 : current + 1;
      if (next >= 0 && next < texts.length) {
        texts[next].focus();
        // Scroll into view
        const row = texts[next].closest(".segment-row");
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
        // Play the segment audio
        const start = parseFloat(row.dataset.start);
        const end = parseFloat(row.dataset.end);
        loopPlaySegment(start, end);
      }
    }
    // Ctrl+Enter — play/loop the current segment
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      const row = e.target.closest(".segment-row");
      if (row) {
        loopPlaySegment(parseFloat(row.dataset.start), parseFloat(row.dataset.end));
      }
    }
  }

  /** Play just this segment's audio range (and loop if played again). */
  function loopPlaySegment(start, end) {
    if (!wavesurfer || wavesurfer.getDuration() <= 0) return;
    loopSegment = { start, end };
    wavesurfer.seekTo(start / wavesurfer.getDuration());
    wavesurfer.play();
  }

  async function saveEdits() {
    if (!transcriptionResult || !hasEdits) return;

    // Read edited text from DOM and apply back to transcriptionResult
    const rows = resultsPreview.querySelectorAll(".segment-row");
    rows.forEach((row) => {
      const idx = parseInt(row.dataset.index, 10);
      const textEl = row.querySelector(".segment-text");
      if (!textEl || idx >= transcriptionResult.segments.length) return;

      const newText = textEl.textContent.trim();
      const seg = transcriptionResult.segments[idx];

      // Update segment text
      seg.text = newText;

      // Read timing edits
      const segStartInput = row.querySelector('.timing-input[data-timing-for="seg-start"]');
      const segEndInput = row.querySelector('.timing-input[data-timing-for="seg-end"]');
      if (segStartInput) {
        const v = parseTimePrecise(segStartInput.value);
        if (!isNaN(v)) seg.start = v;
      }
      if (segEndInput) {
        const v = parseTimePrecise(segEndInput.value);
        if (!isNaN(v)) seg.end = v;
      }

      // Update individual word texts if the user edited word by word
      // Since contenteditable flattens word spans, rebuild words from plain text
      const words = newText.split(/\s+/).filter(Boolean);
      if (seg.words && seg.words.length > 0) {
        // Read word-level timing edits
        const wordItems = row.querySelectorAll(".timing-word-item");

        // Map new words to old word timings (best effort)
        const newWords = [];
        for (let i = 0; i < words.length; i++) {
          if (i < seg.words.length) {
            const wObj = { ...seg.words[i], word: words[i] };
            // Apply word-level timing if present
            if (i < wordItems.length) {
              const ws = wordItems[i].querySelector('.timing-input[data-timing-for="word-start"]');
              const we = wordItems[i].querySelector('.timing-input[data-timing-for="word-end"]');
              if (ws) { const v = parseTimePrecise(ws.value); if (!isNaN(v)) wObj.start = v; }
              if (we) { const v = parseTimePrecise(we.value); if (!isNaN(v)) wObj.end = v; }
            }
            newWords.push(wObj);
          } else {
            // Extra words — use last word's end time
            const lastW = seg.words[seg.words.length - 1];
            newWords.push({ word: words[i], start: lastW.start, end: lastW.end, score: null, speaker: seg.speaker || null });
          }
        }
        seg.words = newWords;
      }
    });

    // Save to backend
    btnEditSave.disabled = true;
    btnEditSave.textContent = "Saving…";
    try {
      await api.updateResult(transcriptionResult);
      hasEdits = false;
      editStatus.textContent = "Saved";
      showToast("Subtitles saved", "success");
      // Re-render to reflect clean state with updated word spans
      renderResults(transcriptionResult);
      // Refresh groups + preview to reflect edited text
      customGroupsEdited = false;
      buildStudioGroups();
      renderGroupEditor();
      drawStudioFrame();
    } catch (err) {
      showToast("Save failed: " + err.message, "error");
    } finally {
      btnEditSave.disabled = false;
      btnEditSave.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg> Save`;
    }
  }

  async function discardEdits() {
    if (hasEdits) {
      // Re-fetch original from backend
      try {
        const fresh = await api.getResult();
        transcriptionResult = fresh;
        renderResults(fresh);
      } catch {
        // If fetch fails, just re-render current
        renderResults(transcriptionResult);
      }
    }
    exitEditMode();
    showToast("Changes discarded");
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

  // --- Media player ---
  function isVideoFile(path) {
    const ext = path.split(".").pop().toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
  }

  function initAudioPlayer() {
    destroyWavesurfer();

    if (!selectedFilePath) return;

    const audioSrc = api.audioUrl(selectedFilePath);
    const isVideo = isVideoFile(selectedFilePath);

    const audioPrevBg = document.getElementById("audio-preview-bg");

    if (isVideo) {
      // Create a fresh <video> element so old WaveSurfer refs can't overwrite it
      const freshVideo = document.createElement("video");
      freshVideo.id = "video-player";
      freshVideo.className = "video-player";
      freshVideo.src = audioSrc;
      const wrap = document.getElementById("video-wrap");
      wrap.replaceChild(freshVideo, videoPlayer);
      videoPlayer = freshVideo;
      if (audioPrevBg) audioPrevBg.classList.add("hidden");

      wavesurfer = WaveSurfer.create({
        container: "#waveform",
        waveColor: "#30363d",
        progressColor: "#58a6ff",
        cursorColor: "#58a6ff",
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 60,
        media: videoPlayer,
      });
    } else {
      // Audio-only: hide video, show preview background for subtitle overlay
      videoPlayer.classList.add("hidden");
      if (audioPrevBg) audioPrevBg.classList.remove("hidden");
      wavesurfer = WaveSurfer.create({
        container: "#waveform",
        waveColor: "#30363d",
        progressColor: "#58a6ff",
        cursorColor: "#58a6ff",
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 60,
        url: audioSrc,
      });
    }

    wavesurfer.on("play", () => {
      iconPlay.classList.add("hidden");
      iconPause.classList.remove("hidden");
    });

    wavesurfer.on("pause", () => {
      iconPlay.classList.remove("hidden");
      iconPause.classList.add("hidden");
      // Redraw overlay so it reflects paused position (clears caption if past segment end)
      const pausedAt = wavesurfer.getCurrentTime();
      drawSubtitleOverlay(pausedAt);
      drawTimeline(pausedAt);
    });

    wavesurfer.on("finish", () => {
      iconPlay.classList.remove("hidden");
      iconPause.classList.add("hidden");
      // Clear subtitle overlay — no caption should show after playback ends
      if (subtitleOverlayCtx && subtitleOverlay) {
        subtitleOverlayCtx.clearRect(0, 0, subtitleOverlay.width, subtitleOverlay.height);
      }
    });

    wavesurfer.on("seeking", (currentTime) => {
      // Keep overlay in sync when user scrubs
      drawSubtitleOverlay(currentTime);
      drawTimeline(currentTime);
    });

    wavesurfer.on("timeupdate", (currentTime) => {
      updatePlayerTime(currentTime, wavesurfer.getDuration());
      highlightCurrentSubtitle(currentTime);
      // Loop enforcement in edit mode
      if (editMode && loopSegment && currentTime >= loopSegment.end) {
        wavesurfer.pause();
        loopSegment = null;
      }
      // Sync studio scrub time if open
      if (studioOpen && studioDuration > 0) {
        studioScrubTime = currentTime;
        drawStudioFrame();
      }
      // Highlight active group in group editor
      if (groupEditorOpen) highlightActiveGroup(currentTime);
      // Draw subtitle overlay on main video
      drawSubtitleOverlay(currentTime);
      // Auto-scroll timeline so playhead stays visible when zoomed in
      if (_tlZoom > 1 && wavesurfer) {
        const duration = wavesurfer.getDuration();
        if (duration > 0) {
          const visibleDur = duration / _tlZoom;
          if (currentTime < _tlScrollT || currentTime > _tlScrollT + visibleDur) {
            // Center playhead in viewport
            _tlScrollT = Math.max(0, Math.min(
              duration - visibleDur,
              currentTime - visibleDur / 2
            ));
          }
        }
      }
      // Update timeline playhead
      drawTimeline(currentTime);
    });

    wavesurfer.on("ready", () => {
      updatePlayerTime(0, wavesurfer.getDuration());
    });

    wavesurfer.on("error", (err) => {
      console.error("WaveSurfer error:", err);
    });
  }

  function destroyWavesurfer() {
    if (wavesurfer) {
      wavesurfer.destroy();
      wavesurfer = null;
    }
    // Replace with a blank video element so any lingering async refs
    // from the old WaveSurfer write to a detached (orphaned) node.
    const blank = document.createElement("video");
    blank.id = "video-player";
    blank.className = "video-player hidden";
    const wrap = document.getElementById("video-wrap");
    wrap.replaceChild(blank, videoPlayer);
    videoPlayer = blank;
    const prevBg = document.getElementById("audio-preview-bg");
    if (prevBg) prevBg.classList.add("hidden");
    if (subtitleOverlay) subtitleOverlay.classList.add("hidden");
    iconPlay.classList.remove("hidden");
    iconPause.classList.add("hidden");
    playerTime.textContent = "00:00 / 00:00";
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

  /** Format seconds as mm:ss.ms (e.g. 01:23.456) for timing editor */
  function formatTimePrecise(seconds) {
    if (!seconds || isNaN(seconds)) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
  }

  /** Parse mm:ss.ms string back to seconds, returns NaN on bad input */
  function parseTimePrecise(str) {
    if (!str) return NaN;
    const match = str.trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
    if (!match) return NaN;
    return parseInt(match[1], 10) * 60 + parseFloat(match[2]);
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function showToast(message, type = "") {
    // Simple toast notification
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.className = "toast" + (type ? " toast-" + type : "");
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
      showToast(`Exported ${res.files.length} file(s)`, "success");
    } catch (err) {
      showToast(`Export failed: ${err.message}`, "error");
    } finally {
      btnExport.disabled = false;
      btnExport.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14ZM7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06Z"/></svg> Export Files`;
    }
  }

  // =========================================================================
  // SUBTITLE VIDEO STUDIO
  // =========================================================================

  const btnRenderVideo   = document.getElementById("btn-render-video");
  const btnRenderBaked   = document.getElementById("btn-render-baked");
  const btnRenderOverlay = document.getElementById("btn-render-overlay");
  const customRenderToggle = document.getElementById("custom-render-toggle");
  const customRenderBody   = document.getElementById("custom-render-body");
  const renderProgressEl = document.getElementById("render-progress");
  const renderProgressBar = document.getElementById("render-progress-bar");
  const renderProgressLabel = document.getElementById("render-progress-label");
  const renderElapsedEl = document.getElementById("render-elapsed");
  const btnRenderCancel  = document.getElementById("btn-render-cancel");
  const studioRenderMode = document.getElementById("studio-render-mode");
  const studioBitrate = document.getElementById("studio-bitrate");
  const studioBitrateRow = document.getElementById("studio-bitrate-row");
  let renderStartTime = null;
  let renderTimer = null;

  // Studio style controls
  const studioFont = document.getElementById("studio-font");
  const studioFontSize = document.getElementById("studio-font-size");
  const studioFontSizeVal = document.getElementById("studio-font-size-val");
  const studioTextColor = document.getElementById("studio-text-color");
  const studioActiveColor = document.getElementById("studio-active-color");
  const studioBgColor = document.getElementById("studio-bg-color");
  const studioTextColorHex = document.getElementById("studio-text-color-hex");
  const studioActiveColorHex = document.getElementById("studio-active-color-hex");
  const studioBgColorHex = document.getElementById("studio-bg-color-hex");
  const btnCustomFont = document.getElementById("btn-custom-font");
  const customFontInput = document.getElementById("custom-font-input");
  let customFontPath = null; // absolute path for backend rendering
  const studioBold = document.getElementById("studio-bold");
  const studioTracking = document.getElementById("studio-tracking");
  const studioTrackingVal = document.getElementById("studio-tracking-val");
  const studioWordSpacing = document.getElementById("studio-word-spacing");
  const studioWordSpacingVal = document.getElementById("studio-word-spacing-val");
  const studioStrokeWidth = document.getElementById("studio-stroke-width");
  const studioStrokeWidthVal = document.getElementById("studio-stroke-width-val");
  const studioStrokeColor = document.getElementById("studio-stroke-color");
  const studioStrokeColorHex = document.getElementById("studio-stroke-color-hex");
  const studioShadowEnabled   = document.getElementById("studio-shadow-enabled");
  const studioShadowOpts      = document.getElementById("studio-shadow-opts");
  const studioShadowColor     = document.getElementById("studio-shadow-color");
  const studioShadowColorHex  = document.getElementById("studio-shadow-color-hex");
  const studioShadowOpacity   = document.getElementById("studio-shadow-opacity");
  const studioShadowOpacityVal= document.getElementById("studio-shadow-opacity-val");
  const studioShadowBlur      = document.getElementById("studio-shadow-blur");
  const studioShadowBlurVal   = document.getElementById("studio-shadow-blur-val");
  const studioShadowOffsetX   = document.getElementById("studio-shadow-offset-x");
  const studioShadowOffsetXVal= document.getElementById("studio-shadow-offset-x-val");
  const studioShadowOffsetY   = document.getElementById("studio-shadow-offset-y");
  const studioShadowOffsetYVal= document.getElementById("studio-shadow-offset-y-val");
  const studioBgOpacity = document.getElementById("studio-bg-opacity");
  const studioBgOpacityVal = document.getElementById("studio-bg-opacity-val");
  const studioPadH = document.getElementById("studio-pad-h");
  const studioPadHVal = document.getElementById("studio-pad-h-val");
  const studioPadV = document.getElementById("studio-pad-v");
  const studioPadVVal = document.getElementById("studio-pad-v-val");
  const studioRadius = document.getElementById("studio-radius");
  const studioRadiusVal = document.getElementById("studio-radius-val");
  const studioWpg = document.getElementById("studio-wpg");
  const studioWpgVal = document.getElementById("studio-wpg-val");
  const studioLines = document.getElementById("studio-lines");
  const studioLinesVal = document.getElementById("studio-lines-val");
  const studioPosX = document.getElementById("studio-pos-x");
  const studioPosXVal = document.getElementById("studio-pos-x-val");
  const studioPosY = document.getElementById("studio-pos-y");
  const studioPosYVal = document.getElementById("studio-pos-y-val");
  const studioBgWidthExtra = document.getElementById("studio-bg-width-extra");
  const studioBgWidthExtraVal = document.getElementById("studio-bg-width-extra-val");
  const studioBgHeightExtra = document.getElementById("studio-bg-height-extra");
  const studioBgHeightExtraVal = document.getElementById("studio-bg-height-extra-val");
  const studioTextOffsetX = document.getElementById("studio-text-offset-x");
  const studioTextOffsetXVal = document.getElementById("studio-text-offset-x-val");
  const studioTextOffsetY = document.getElementById("studio-text-offset-y");
  const studioTextOffsetYVal = document.getElementById("studio-text-offset-y-val");
  const studioResolution = document.getElementById("studio-resolution");
  const studioFps = document.getElementById("studio-fps");
  const studioFormat = document.getElementById("studio-format");
  const studioAnimation = document.getElementById("studio-animation");
  const studioAnimDur = document.getElementById("studio-anim-dur");
  const studioAnimDurVal = document.getElementById("studio-anim-dur-val");
  const studioAnimDurRow = document.getElementById("studio-anim-dur-row");
  const studioWordTransition = document.getElementById("studio-word-transition");
  // Per-style option panels
  const wsoHighlight         = document.getElementById("wso-highlight");
  const wsoHighlightRadius   = document.getElementById("wso-highlight-radius");
  const wsoHighlightRadiusV  = document.getElementById("wso-highlight-radius-val");
  const wsoHighlightPaddingX  = document.getElementById("wso-highlight-padding-x");
  const wsoHighlightPaddingXV = document.getElementById("wso-highlight-padding-x-val");
  const wsoHighlightPaddingY  = document.getElementById("wso-highlight-padding-y");
  const wsoHighlightPaddingYV = document.getElementById("wso-highlight-padding-y-val");
  const wsoHighlightOpacity  = document.getElementById("wso-highlight-opacity");
  const wsoHighlightOpacityV = document.getElementById("wso-highlight-opacity-val");
  const wsoHighlightAnim     = document.getElementById("wso-highlight-anim");
  const wsoUnderline        = document.getElementById("wso-underline");
  const wsoUnderlineThick   = document.getElementById("wso-underline-thickness");
  const wsoUnderlineThickV  = document.getElementById("wso-underline-thickness-val");
  const wsoUnderlineColor   = document.getElementById("wso-underline-color");
  const wsoUnderlineColorHex= document.getElementById("wso-underline-color-hex");
  const wsoBounce           = document.getElementById("wso-bounce");
  const wsoBounceStrength   = document.getElementById("wso-bounce-strength");
  const wsoBounceStrengthV  = document.getElementById("wso-bounce-strength-val");
  const wsoScale            = document.getElementById("wso-scale");
  const wsoScaleFactor      = document.getElementById("wso-scale-factor");
  const wsoScaleFactorV     = document.getElementById("wso-scale-factor-val");

  let studioOpen = true;
  let studioGroups = [];
  let studioDuration = 0;
  let studioScrubTime = 0;

  // All range sliders update their label and redraw
  const studioRangeInputs = [
    [studioFontSize, studioFontSizeVal, "px"],
    [studioTracking, studioTrackingVal, "px"],
    [studioWordSpacing, studioWordSpacingVal, "px"],
    [studioStrokeWidth, studioStrokeWidthVal, "px"],
    [studioBgOpacity, studioBgOpacityVal, "%"],
    [studioPadH, studioPadHVal, "px"],
    [studioPadV, studioPadVVal, "px"],
    [studioRadius, studioRadiusVal, "px"],
    [studioWpg, studioWpgVal, ""],
    [studioLines, studioLinesVal, ""],
    [studioPosX, studioPosXVal, "%"],
    [studioPosY, studioPosYVal, "%"],
    [studioBgWidthExtra, studioBgWidthExtraVal, "px"],
    [studioBgHeightExtra, studioBgHeightExtraVal, "px"],
    [studioTextOffsetX, studioTextOffsetXVal, "px"],
    [studioTextOffsetY, studioTextOffsetYVal, "px"],
    [studioShadowOpacity,  studioShadowOpacityVal,  "%"],
    [studioShadowBlur,     studioShadowBlurVal,      "px"],
    [studioShadowOffsetX,  studioShadowOffsetXVal,   "px"],
    [studioShadowOffsetY,  studioShadowOffsetYVal,   "px"],
  ];

  studioRangeInputs.forEach(([input, label]) => {
    if (input) {
      input.addEventListener("input", () => {
        label.value = input.value;
        if (input === studioWpg) {
          customGroupsEdited = false;
          buildStudioGroups();
          renderGroupEditor();
        }
        drawStudioFrame();
      });
    }
  });

  // Generic bidirectional sync + reset for all slider rows
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    const numInput = slider.nextElementSibling;
    if (!numInput || !numInput.classList.contains("range-num")) return;
    const resetBtn = numInput.nextElementSibling;
    const defaultVal = slider.getAttribute("value");
    numInput.addEventListener("change", () => {
      const v = parseFloat(numInput.value);
      if (!isNaN(v)) {
        slider.value = v;                          // slider clamps visually to its range
        slider.dispatchEvent(new Event("input"));  // updates other listeners (wpg → rebuild)
        numInput.value = v;                        // restore unclamped value overwritten by listener
      }
    });
    if (resetBtn && resetBtn.classList.contains("reset-btn")) {
      resetBtn.addEventListener("click", () => {
        slider.value = defaultVal;
        numInput.value = defaultVal;
        slider.dispatchEvent(new Event("input"));
      });
    }
  });

  // Color/select controls redraw
  [studioFont, studioTextColor, studioActiveColor, studioBgColor, studioStrokeColor, studioResolution].forEach((el) => {
    if (el) el.addEventListener("input", () => drawStudioFrame());
  });

  // Animation controls
  function _updateAnimDurVisibility() {
    if (studioAnimDurRow) studioAnimDurRow.style.display = studioAnimation && studioAnimation.value !== "none" ? "" : "none";
  }
  if (studioAnimation) {
    studioAnimation.addEventListener("input", () => { _updateAnimDurVisibility(); drawStudioFrame(); });
    _updateAnimDurVisibility();
  }
  if (studioAnimDur && studioAnimDurVal) {
    studioAnimDur.addEventListener("input", () => {
      studioAnimDurVal.value = studioAnimDur.value;
      drawStudioFrame();
    });
  }
  // Word-style sub-panel visibility
  const wsoAllPanels = { highlight: wsoHighlight, underline: wsoUnderline, bounce: wsoBounce, scale: wsoScale };
  function _updateWordStyleOpts() {
    const v = studioWordTransition ? studioWordTransition.value : "none";
    Object.entries(wsoAllPanels).forEach(([k, el]) => {
      if (el) el.style.display = (k === v) ? "" : "none";
    });
  }
  if (studioWordTransition) {
    studioWordTransition.addEventListener("input", () => { _updateWordStyleOpts(); drawStudioFrame(); });
    _updateWordStyleOpts();
  }

  // Highlight sliders + animation
  if (wsoHighlightRadius   && wsoHighlightRadiusV)   wsoHighlightRadius  .addEventListener("input", () => { wsoHighlightRadiusV  .value = wsoHighlightRadius.value;   drawStudioFrame(); });
  if (wsoHighlightPaddingX && wsoHighlightPaddingXV) wsoHighlightPaddingX.addEventListener("input", () => { wsoHighlightPaddingXV.value = wsoHighlightPaddingX.value; drawStudioFrame(); });
  if (wsoHighlightPaddingY && wsoHighlightPaddingYV) wsoHighlightPaddingY.addEventListener("input", () => { wsoHighlightPaddingYV.value = wsoHighlightPaddingY.value; drawStudioFrame(); });
  if (wsoHighlightOpacity  && wsoHighlightOpacityV)  wsoHighlightOpacity .addEventListener("input", () => { wsoHighlightOpacityV .value = wsoHighlightOpacity.value;   drawStudioFrame(); });
  if (wsoHighlightAnim) wsoHighlightAnim.addEventListener("change", () => drawStudioFrame());

  // Underline sliders + color
  if (wsoUnderlineThick && wsoUnderlineThickV) {
    wsoUnderlineThick.addEventListener("input", () => { wsoUnderlineThickV.value = wsoUnderlineThick.value; drawStudioFrame(); });
  }
  if (wsoUnderlineColor && wsoUnderlineColorHex) {
    wsoUnderlineColor.addEventListener("input", () => { wsoUnderlineColorHex.value = wsoUnderlineColor.value.toUpperCase(); drawStudioFrame(); });
    wsoUnderlineColorHex.addEventListener("input", () => { if (/^#[0-9A-Fa-f]{6}$/.test(wsoUnderlineColorHex.value)) { wsoUnderlineColor.value = wsoUnderlineColorHex.value; drawStudioFrame(); } });
  }

  // Bounce strength slider
  if (wsoBounceStrength && wsoBounceStrengthV) {
    wsoBounceStrength.addEventListener("input", () => { wsoBounceStrengthV.value = wsoBounceStrength.value; drawStudioFrame(); });
  }

  // Scale factor slider
  if (wsoScaleFactor && wsoScaleFactorV) {
    wsoScaleFactor.addEventListener("input", () => { wsoScaleFactorV.value = wsoScaleFactor.value; drawStudioFrame(); });
  }

  // Bold toggle redraws
  if (studioBold) studioBold.addEventListener("change", () => drawStudioFrame());

  // Stroke color hex sync
  if (studioStrokeColor && studioStrokeColorHex) {
    studioStrokeColor.addEventListener("input", () => { studioStrokeColorHex.value = studioStrokeColor.value.toUpperCase(); });
    studioStrokeColorHex.addEventListener("input", () => { if (/^#[0-9A-Fa-f]{6}$/.test(studioStrokeColorHex.value)) studioStrokeColor.value = studioStrokeColorHex.value; drawStudioFrame(); });
  }

  // Shadow toggle + color picker
  if (studioShadowEnabled && studioShadowOpts) {
    studioShadowEnabled.addEventListener("change", () => {
      studioShadowOpts.style.display = studioShadowEnabled.checked ? "" : "none";
      drawStudioFrame();
    });
  }
  if (studioShadowColor && studioShadowColorHex) {
    studioShadowColor.addEventListener("input", () => {
      studioShadowColorHex.value = studioShadowColor.value.toUpperCase();
      drawStudioFrame();
    });
    studioShadowColorHex.addEventListener("input", () => {
      const v = studioShadowColorHex.value.startsWith("#") ? studioShadowColorHex.value : "#" + studioShadowColorHex.value;
      if (/^#[0-9A-Fa-f]{6}$/.test(v)) { studioShadowColor.value = v; drawStudioFrame(); }
    });
    studioShadowColorHex.addEventListener("blur", () => {
      studioShadowColorHex.value = studioShadowColor.value.toUpperCase();
    });
  }

  // Sync color pickers ↔ hex inputs
  const colorHexPairs = [
    [studioTextColor, studioTextColorHex],
    [studioActiveColor, studioActiveColorHex],
    [studioBgColor, studioBgColorHex],
  ];
  colorHexPairs.forEach(([picker, hex]) => {
    if (!picker || !hex) return;
    picker.addEventListener("input", () => {
      hex.value = picker.value.toUpperCase();
    });
    hex.addEventListener("input", () => {
      const v = hex.value.startsWith("#") ? hex.value : "#" + hex.value;
      if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
        picker.value = v;
        drawStudioFrame();
      }
    });
    hex.addEventListener("blur", () => {
      hex.value = picker.value.toUpperCase();
    });
  });

  // Render mode toggle — show/hide bitrate, auto-switch format
  function updateRenderModeUI() {
    const mode = studioRenderMode ? studioRenderMode.value : "overlay";
    const isBaked = mode === "baked";
    if (studioBitrateRow) studioBitrateRow.style.display = isBaked ? "" : "none";
    if (isBaked && studioFormat) {
      // Baked mode only supports MP4
      studioFormat.value = "mp4";
      studioFormat.disabled = true;
    } else if (studioFormat) {
      studioFormat.disabled = false;
    }
  }

  if (studioRenderMode) {
    studioRenderMode.addEventListener("change", updateRenderModeUI);
    updateRenderModeUI();
  }

  // Custom font upload
  if (btnCustomFont && customFontInput) {
    btnCustomFont.addEventListener("click", () => customFontInput.click());
    customFontInput.addEventListener("change", async () => {
      const file = customFontInput.files[0];
      if (!file) return;
      const fontName = file.name.replace(/\.[^.]+$/, "");
      // Load into browser for canvas preview
      try {
        const fontData = await file.arrayBuffer();
        const fontFace = new FontFace(fontName, fontData);
        await fontFace.load();
        document.fonts.add(fontFace);
      } catch (e) {
        showToast("Failed to load font: " + e.message, "error");
        return;
      }
      // Save to persistent storage (send binary data, not file path — sandbox blocks file.path)
      let savedPath = null;
      if (window.subforge && window.subforge.saveFont) {
        try {
          const fontData = await file.arrayBuffer();
          savedPath = await window.subforge.saveFont(file.name, fontData);
        } catch (_) { /* save failed, font still works for this session */ }
      }
      // Add to dropdown if not already there
      addFontToDropdown(fontName, savedPath);
      studioFont.value = fontName;
      customFontPath = savedPath;
      showToast(`Font "${fontName}" saved`, "success");
      drawStudioFrame();
    });
  }

  /** Add a custom font option to the dropdown. */
  function addFontToDropdown(fontName, fontPath) {
    for (const opt of studioFont.options) {
      if (opt.value === fontName) return;
    }
    const opt = document.createElement("option");
    opt.value = fontName;
    opt.textContent = fontName + " ★";
    opt.dataset.customPath = fontPath || "";
    studioFont.insertBefore(opt, studioFont.firstChild);
  }

  // Track font selection to update customFontPath
  if (studioFont) {
    studioFont.addEventListener("change", () => {
      const sel = studioFont.options[studioFont.selectedIndex];
      customFontPath = (sel && sel.dataset.customPath) || null;
      drawStudioFrame();
    });
  }

  // Load saved fonts on startup
  (async function loadSavedFonts() {
    if (!window.subforge || !window.subforge.listFonts) return;
    try {
      const fonts = await window.subforge.listFonts();
      for (const f of fonts) {
        try {
          const buf = await window.subforge.readFont(f.path);
          if (!buf) continue;
          const face = new FontFace(f.name, buf);
          await face.load();
          document.fonts.add(face);
          addFontToDropdown(f.name, f.path);
        } catch (_) { /* skip broken fonts */ }
      }
      // Sync customFontPath with current dropdown selection (it may have been
      // set by a preset before the options existed, so re-check now)
      syncCustomFontPath();
    } catch (_) { /* no fonts API */ }
  })();

  /** Sync customFontPath from the currently selected dropdown option. */
  function syncCustomFontPath() {
    if (!studioFont) return;
    const sel = studioFont.options[studioFont.selectedIndex];
    if (sel && sel.dataset.customPath) {
      customFontPath = sel.dataset.customPath;
    }
  }

  // --- Style Presets ---
  const studioPreset = document.getElementById("studio-preset");
  const btnPresetSave = document.getElementById("btn-preset-save");
  const btnPresetDelete = document.getElementById("btn-preset-delete");
  const tplTileGrid = document.getElementById("tpl-tile-grid");

  // Built-in style templates
  const BUILTIN_TEMPLATES = [
    {
      name: "YouTube Bold",
      settings: { font: "Arial", fontSize: "72", bold: true, tracking: "0", wordSpacing: "0",
        strokeWidth: "0", strokeColor: "#000000", textColor: "#FFFFFF", activeColor: "#FFD700",
        bgColor: "#000000", bgOpacity: "85", padH: "32", padV: "14", radius: "10",
        wpg: "4", lines: "1", posX: "50", posY: "88", bgWidthExtra: "0", bgHeightExtra: "0",
        textOffsetX: "0", textOffsetY: "0", wordTransition: "instant",
        animation: "none", animDur: "12", shadowEnabled: false },
    },
    {
      name: "TikTok Pop",
      settings: { font: "Arial", fontSize: "80", bold: true, tracking: "2", wordSpacing: "2",
        strokeWidth: "3", strokeColor: "#000000", textColor: "#FFFFFF", activeColor: "#FF2D55",
        bgColor: "#000000", bgOpacity: "0", padH: "24", padV: "10", radius: "8",
        wpg: "3", lines: "1", posX: "50", posY: "82", bgWidthExtra: "0", bgHeightExtra: "0",
        textOffsetX: "0", textOffsetY: "0", wordTransition: "bounce",
        animation: "pop", animDur: "12", shadowEnabled: false },
    },
    {
      name: "Minimal White",
      settings: { font: "Arial", fontSize: "56", bold: false, tracking: "1", wordSpacing: "0",
        strokeWidth: "0", strokeColor: "#000000", textColor: "#FFFFFF", activeColor: "#FFFFFF",
        bgColor: "#000000", bgOpacity: "0", padH: "16", padV: "8", radius: "6",
        wpg: "5", lines: "2", posX: "50", posY: "90", bgWidthExtra: "0", bgHeightExtra: "0",
        textOffsetX: "0", textOffsetY: "0", wordTransition: "crossfade",
        animation: "fade", animDur: "10",
        shadowEnabled: true, shadowColor: "#000000", shadowOpacity: "90", shadowBlur: "6", shadowOffsetX: "2", shadowOffsetY: "2" },
    },
    {
      name: "Highlight Pill",
      settings: { font: "Arial", fontSize: "64", bold: true, tracking: "0", wordSpacing: "0",
        strokeWidth: "0", strokeColor: "#000000", textColor: "#FFFFFF", activeColor: "#FFFFFF",
        bgColor: "#1A1A2E", bgOpacity: "90", padH: "36", padV: "16", radius: "20",
        wpg: "4", lines: "1", posX: "50", posY: "84", bgWidthExtra: "0", bgHeightExtra: "0",
        textOffsetX: "0", textOffsetY: "0", wordTransition: "highlight",
        animation: "slide", animDur: "12",
        wsoHighlightRadius: "16", wsoHighlightPaddingX: "10", wsoHighlightPaddingY: "8",
        wsoHighlightOpacity: "100", wsoHighlightAnim: "slide", shadowEnabled: false },
    },
    {
      name: "Karaoke Neon",
      settings: { font: "Arial", fontSize: "68", bold: true, tracking: "1", wordSpacing: "2",
        strokeWidth: "2", strokeColor: "#7B2FFF", textColor: "#DDDDFF", activeColor: "#7B2FFF",
        bgColor: "#0A0010", bgOpacity: "88", padH: "40", padV: "18", radius: "14",
        wpg: "4", lines: "1", posX: "50", posY: "86", bgWidthExtra: "0", bgHeightExtra: "0",
        textOffsetX: "0", textOffsetY: "0", wordTransition: "karaoke",
        animation: "fade", animDur: "8", shadowEnabled: false },
    },
    {
      name: "Subtitles (Clean)",
      settings: { font: "Arial", fontSize: "48", bold: false, tracking: "0", wordSpacing: "0",
        strokeWidth: "0", strokeColor: "#000000", textColor: "#FFFFFF", activeColor: "#FFD700",
        bgColor: "#000000", bgOpacity: "70", padH: "20", padV: "8", radius: "4",
        wpg: "6", lines: "2", posX: "50", posY: "92", bgWidthExtra: "0", bgHeightExtra: "0",
        textOffsetX: "0", textOffsetY: "0", wordTransition: "instant",
        animation: "none", animDur: "12", shadowEnabled: false },
    },
    {
      name: "Reveal Dark",
      settings: { font: "Arial", fontSize: "64", bold: true, tracking: "0", wordSpacing: "0",
        strokeWidth: "0", strokeColor: "#000000", textColor: "#CCCCCC", activeColor: "#FFFFFF",
        bgColor: "#111111", bgOpacity: "92", padH: "32", padV: "14", radius: "12",
        wpg: "4", lines: "1", posX: "50", posY: "84", bgWidthExtra: "0", bgHeightExtra: "0",
        textOffsetX: "0", textOffsetY: "0", wordTransition: "reveal",
        animation: "fade", animDur: "10", shadowEnabled: false },
    },
  ];

  // Build Caption Styles tile grid
  if (tplTileGrid) {
    const PREVIEW_WORDS = ["Lets", "create", "with", "CapForge"];
    BUILTIN_TEMPLATES.forEach((tpl, idx) => {
      const s = tpl.settings;
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tpl-tile";
      tile.dataset.tplIdx = String(idx);
      tile.dataset.wt = s.wordTransition || "instant";
      tile.dataset.entry = s.animation || "none";
      tile.setAttribute("title", `Apply "${tpl.name}"`);

      // Scale template style down into a compact preview banner.
      const bgAlpha = (Number(s.bgOpacity) || 0) / 100;
      const strokeW = Math.max(0, Number(s.strokeWidth) || 0);
      const previewBg = `${hexToRgba(s.bgColor || "#000", bgAlpha)}`;
      const padX = Math.max(6, Math.round((Number(s.padH) || 20) * 0.28));
      const padY = Math.max(3, Math.round((Number(s.padV) || 10) * 0.35));
      const radius = Math.max(2, Math.round((Number(s.radius) || 0) * 0.6));
      const fontWeight = s.bold ? 700 : 500;
      const fontFam = s.font || "Arial";

      const preview = document.createElement("div");
      preview.className = "tpl-tile-preview";
      const banner = document.createElement("div");
      banner.className = "tpl-tile-banner";
      banner.style.cssText = [
        `background:${previewBg}`,
        `border-radius:${radius}px`,
        `padding:${padY}px ${padX}px`,
        `color:${s.textColor || "#fff"}`,
        `font-family:${fontFam}`,
        `font-weight:${fontWeight}`,
        strokeW > 0 ? `-webkit-text-stroke:${Math.min(2, strokeW * 0.35)}px ${s.strokeColor || "#000"}` : "",
      ].filter(Boolean).join(";");
      banner.style.setProperty("--tpl-active", s.activeColor || "#FFD700");
      banner.style.setProperty("--tpl-text", s.textColor || "#FFFFFF");
      banner.style.setProperty("--tpl-underline", (s.wsoUnderlineColor || s.activeColor || "#FFD700"));
      banner.style.setProperty("--tpl-bg-solid", s.bgColor || "#000000");

      PREVIEW_WORDS.forEach((w, wi) => {
        const span = document.createElement("span");
        span.className = "tpl-word";
        span.style.animationDelay = `${wi * 0.35}s`;
        span.textContent = w;
        banner.appendChild(span);
        if (wi < PREVIEW_WORDS.length - 1) banner.appendChild(document.createTextNode(" "));
      });

      preview.appendChild(banner);
      const name = document.createElement("div");
      name.className = "tpl-tile-name";
      name.textContent = tpl.name;

      tile.appendChild(preview);
      tile.appendChild(name);
      tile.addEventListener("click", () => {
        applyStudioSettings(tpl.settings);
        markActiveTile(idx);
        showToast(`Template "${tpl.name}" applied`);
      });
      tplTileGrid.appendChild(tile);
    });
  }

  function markActiveTile(idx) {
    if (!tplTileGrid) return;
    tplTileGrid.querySelectorAll(".tpl-tile").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.tplIdx) === idx);
    });
  }

  function hexToRgba(hex, a) {
    const h = (hex || "").replace("#", "");
    if (h.length !== 6) return `rgba(0,0,0,${a})`;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Collapsible: Custom Settings
  const customSettingsToggle = document.getElementById("custom-settings-toggle");
  const customSettingsBody = document.getElementById("custom-settings-body");
  if (customSettingsToggle && customSettingsBody) {
    customSettingsToggle.addEventListener("click", () => {
      const collapsed = customSettingsBody.classList.toggle("collapsed");
      customSettingsToggle.setAttribute("aria-expanded", String(!collapsed));
    });
  }

  /** Gather all current studio control values into a serializable object. */
  function gatherStudioSettings() {
    return {
      font: studioFont.value,
      customFontPath: customFontPath || null,
      fontSize: studioFontSizeVal ? studioFontSizeVal.value : studioFontSize.value,
      bold: studioBold ? studioBold.checked : true,
      tracking: studioTrackingVal ? studioTrackingVal.value : (studioTracking ? studioTracking.value : "0"),
      wordSpacing: studioWordSpacingVal ? studioWordSpacingVal.value : (studioWordSpacing ? studioWordSpacing.value : "0"),
      strokeWidth: studioStrokeWidthVal ? studioStrokeWidthVal.value : (studioStrokeWidth ? studioStrokeWidth.value : "0"),
      strokeColor: studioStrokeColor ? studioStrokeColor.value : "#000000",
      textColor: studioTextColor.value,
      activeColor: studioActiveColor.value,
      bgColor: studioBgColor.value,
      bgOpacity: studioBgOpacityVal ? studioBgOpacityVal.value : studioBgOpacity.value,
      padH: studioPadHVal ? studioPadHVal.value : studioPadH.value,
      padV: studioPadVVal ? studioPadVVal.value : studioPadV.value,
      radius: studioRadiusVal ? studioRadiusVal.value : studioRadius.value,
      wpg: studioWpgVal ? studioWpgVal.value : studioWpg.value,
      lines: studioLinesVal ? studioLinesVal.value : (studioLines ? studioLines.value : "1"),
      posX: studioPosXVal ? studioPosXVal.value : (studioPosX ? studioPosX.value : "50"),
      posY: studioPosYVal ? studioPosYVal.value : studioPosY.value,
      bgWidthExtra:  studioBgWidthExtraVal  ? studioBgWidthExtraVal.value  : (studioBgWidthExtra  ? studioBgWidthExtra.value  : "0"),
      bgHeightExtra: studioBgHeightExtraVal ? studioBgHeightExtraVal.value : (studioBgHeightExtra ? studioBgHeightExtra.value : "0"),
      textOffsetX:   studioTextOffsetXVal   ? studioTextOffsetXVal.value   : (studioTextOffsetX   ? studioTextOffsetX.value   : "0"),
      textOffsetY:   studioTextOffsetYVal   ? studioTextOffsetYVal.value   : (studioTextOffsetY   ? studioTextOffsetY.value   : "0"),
      resolution: studioResolution.value,
      fps: studioFps.value,
      format: studioFormat.value,
      renderMode: studioRenderMode.value,
      bitrate: studioBitrate.value,
      animation: studioAnimation ? studioAnimation.value : "none",
      animDur: studioAnimDur ? studioAnimDur.value : "12",
      wordTransition: studioWordTransition ? studioWordTransition.value : "instant",
      wsoHighlightRadius: wsoHighlightRadius ? wsoHighlightRadius.value : "16",
      wsoHighlightPaddingX: wsoHighlightPaddingX ? wsoHighlightPaddingX.value : "6",
      wsoHighlightPaddingY: wsoHighlightPaddingY ? wsoHighlightPaddingY.value : "6",
      wsoHighlightOpacity: wsoHighlightOpacity ? wsoHighlightOpacity.value : "85",
      wsoHighlightAnim: wsoHighlightAnim ? wsoHighlightAnim.value : "jump",
      wsoUnderlineThick: wsoUnderlineThick ? wsoUnderlineThick.value : "4",
      wsoUnderlineColor: wsoUnderlineColor ? wsoUnderlineColor.value : "#FFD700",
      wsoBounceStrength: wsoBounceStrength ? wsoBounceStrength.value : "18",
      wsoScaleFactor: wsoScaleFactor ? wsoScaleFactor.value : "125",
      shadowEnabled: studioShadowEnabled ? studioShadowEnabled.checked : false,
      shadowColor: studioShadowColor ? studioShadowColor.value : "#000000",
      shadowOpacity: studioShadowOpacityVal ? studioShadowOpacityVal.value : (studioShadowOpacity ? studioShadowOpacity.value : "80"),
      shadowBlur: studioShadowBlurVal ? studioShadowBlurVal.value : (studioShadowBlur ? studioShadowBlur.value : "8"),
      shadowOffsetX: studioShadowOffsetXVal ? studioShadowOffsetXVal.value : (studioShadowOffsetX ? studioShadowOffsetX.value : "3"),
      shadowOffsetY: studioShadowOffsetYVal ? studioShadowOffsetYVal.value : (studioShadowOffsetY ? studioShadowOffsetY.value : "3"),
    };
  }

  /** Apply a preset object to all studio controls. */
  function applyStudioSettings(p) {
    if (!p) return;
    // Ensure custom font option exists in dropdown before setting value
    if (p.font && p.customFontPath) {
      addFontToDropdown(p.font, p.customFontPath);
    }
    if (p.font) studioFont.value = p.font;
    customFontPath = p.customFontPath || null;
    // If preset didn't store the path, try resolving from the dropdown option
    if (!customFontPath) syncCustomFontPath();
    if (p.fontSize) { studioFontSize.value = p.fontSize; studioFontSizeVal.value = p.fontSize; }
    if (studioBold && p.bold !== undefined) studioBold.checked = p.bold;
    if (p.tracking !== undefined && studioTracking) { studioTracking.value = p.tracking; studioTrackingVal.value = p.tracking; }
    if (p.wordSpacing !== undefined && studioWordSpacing) { studioWordSpacing.value = p.wordSpacing; studioWordSpacingVal.value = p.wordSpacing; }
    if (p.strokeWidth !== undefined && studioStrokeWidth) { studioStrokeWidth.value = p.strokeWidth; studioStrokeWidthVal.value = p.strokeWidth; }
    if (p.strokeColor && studioStrokeColor) { studioStrokeColor.value = p.strokeColor; studioStrokeColorHex.value = p.strokeColor.toUpperCase(); }
    if (p.textColor) { studioTextColor.value = p.textColor; studioTextColorHex.value = p.textColor.toUpperCase(); }
    if (p.activeColor) { studioActiveColor.value = p.activeColor; studioActiveColorHex.value = p.activeColor.toUpperCase(); }
    if (p.bgColor) { studioBgColor.value = p.bgColor; studioBgColorHex.value = p.bgColor.toUpperCase(); }
    if (p.bgOpacity) { studioBgOpacity.value = p.bgOpacity; studioBgOpacityVal.value = p.bgOpacity; }
    if (p.padH) { studioPadH.value = p.padH; studioPadHVal.value = p.padH; }
    if (p.padV) { studioPadV.value = p.padV; studioPadVVal.value = p.padV; }
    if (p.radius) { studioRadius.value = p.radius; studioRadiusVal.value = p.radius; }
    if (p.wpg) { studioWpg.value = p.wpg; studioWpgVal.value = p.wpg; }
    if (p.lines !== undefined && studioLines) { studioLines.value = p.lines; studioLinesVal.value = p.lines; }
    if (p.posX !== undefined && studioPosX) { studioPosX.value = p.posX; studioPosXVal.value = p.posX; }
    if (p.posY) { studioPosY.value = p.posY; studioPosYVal.value = p.posY; }
    if (p.bgWidthExtra  !== undefined && studioBgWidthExtra)  { studioBgWidthExtra.value  = p.bgWidthExtra;  studioBgWidthExtraVal.value  = p.bgWidthExtra; }
    if (p.bgHeightExtra !== undefined && studioBgHeightExtra) { studioBgHeightExtra.value = p.bgHeightExtra; studioBgHeightExtraVal.value = p.bgHeightExtra; }
    if (p.textOffsetX   !== undefined && studioTextOffsetX)   { studioTextOffsetX.value   = p.textOffsetX;   studioTextOffsetXVal.value   = p.textOffsetX; }
    if (p.textOffsetY   !== undefined && studioTextOffsetY)   { studioTextOffsetY.value   = p.textOffsetY;   studioTextOffsetYVal.value   = p.textOffsetY; }
    if (p.resolution) studioResolution.value = p.resolution;
    if (p.fps) studioFps.value = p.fps;
    if (p.format) studioFormat.value = p.format;
    if (p.renderMode) studioRenderMode.value = p.renderMode;
    if (p.bitrate) studioBitrate.value = p.bitrate;
    if (p.animation && studioAnimation) { studioAnimation.value = p.animation; _updateAnimDurVisibility(); }
    if (p.animDur !== undefined && studioAnimDur) { studioAnimDur.value = p.animDur; studioAnimDurVal.value = p.animDur; }
    if (p.wordTransition && studioWordTransition) { studioWordTransition.value = p.wordTransition; _updateWordStyleOpts(); }
    if (p.wsoHighlightRadius !== undefined && wsoHighlightRadius) { wsoHighlightRadius.value = p.wsoHighlightRadius; wsoHighlightRadiusV.value = p.wsoHighlightRadius; }
    if (p.wsoHighlightPaddingX !== undefined && wsoHighlightPaddingX) { wsoHighlightPaddingX.value = p.wsoHighlightPaddingX; wsoHighlightPaddingXV.value = p.wsoHighlightPaddingX; }
    if (p.wsoHighlightPaddingY !== undefined && wsoHighlightPaddingY) { wsoHighlightPaddingY.value = p.wsoHighlightPaddingY; wsoHighlightPaddingYV.value = p.wsoHighlightPaddingY; }
    if (p.wsoHighlightOpacity !== undefined && wsoHighlightOpacity) { wsoHighlightOpacity.value = p.wsoHighlightOpacity; wsoHighlightOpacityV.value = p.wsoHighlightOpacity; }
    if (p.wsoHighlightAnim && wsoHighlightAnim) { wsoHighlightAnim.value = p.wsoHighlightAnim; }
    if (p.wsoUnderlineThick !== undefined && wsoUnderlineThick) { wsoUnderlineThick.value = p.wsoUnderlineThick; wsoUnderlineThickV.value = p.wsoUnderlineThick; }
    if (p.wsoUnderlineColor && wsoUnderlineColor) { wsoUnderlineColor.value = p.wsoUnderlineColor; wsoUnderlineColorHex.value = p.wsoUnderlineColor.toUpperCase(); }
    if (p.wsoBounceStrength !== undefined && wsoBounceStrength) { wsoBounceStrength.value = p.wsoBounceStrength; wsoBounceStrengthV.value = p.wsoBounceStrength; }
    if (p.wsoScaleFactor !== undefined && wsoScaleFactor) { wsoScaleFactor.value = p.wsoScaleFactor; wsoScaleFactorV.value = p.wsoScaleFactor; }
    if (p.shadowEnabled !== undefined && studioShadowEnabled) {
      studioShadowEnabled.checked = p.shadowEnabled;
      if (studioShadowOpts) studioShadowOpts.style.display = p.shadowEnabled ? "" : "none";
    }
    if (p.shadowColor && studioShadowColor) { studioShadowColor.value = p.shadowColor; if (studioShadowColorHex) studioShadowColorHex.value = p.shadowColor.toUpperCase(); }
    if (p.shadowOpacity !== undefined && studioShadowOpacity) { studioShadowOpacity.value = p.shadowOpacity; if (studioShadowOpacityVal) studioShadowOpacityVal.value = p.shadowOpacity; }
    if (p.shadowBlur !== undefined && studioShadowBlur) { studioShadowBlur.value = p.shadowBlur; if (studioShadowBlurVal) studioShadowBlurVal.value = p.shadowBlur; }
    if (p.shadowOffsetX !== undefined && studioShadowOffsetX) { studioShadowOffsetX.value = p.shadowOffsetX; if (studioShadowOffsetXVal) studioShadowOffsetXVal.value = p.shadowOffsetX; }
    if (p.shadowOffsetY !== undefined && studioShadowOffsetY) { studioShadowOffsetY.value = p.shadowOffsetY; if (studioShadowOffsetYVal) studioShadowOffsetYVal.value = p.shadowOffsetY; }
    updateRenderModeUI();
    buildStudioGroups();
    drawStudioFrame();
  }

  /** Refresh the preset dropdown with saved preset names. */
  async function refreshPresetList() {
    if (!window.subforge || !window.subforge.listPresets) return;
    try {
      const names = await window.subforge.listPresets();
      // Remove existing preset options (keep the first "— Presets —" option)
      while (studioPreset.options.length > 1) studioPreset.remove(1);
      names.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        studioPreset.appendChild(opt);
      });
      // Auto-restore last used preset if still present.
      if (window.subforge.getState) {
        const last = await window.subforge.getState("lastPreset", null);
        if (last && names.includes(last)) {
          studioPreset.value = last;
          const preset = await window.subforge.loadPreset(last);
          if (preset) applyStudioSettings(preset);
        }
      }
    } catch (_) { /* preset API not available */ }
  }

  if (studioPreset) {
    studioPreset.addEventListener("change", async () => {
      const name = studioPreset.value;
      if (!name || !window.subforge) return;
      try {
        const preset = await window.subforge.loadPreset(name);
        if (preset) {
          applyStudioSettings(preset);
          if (window.subforge.setState) {
            window.subforge.setState("lastPreset", name);
          }
          showToast(`Preset "${name}" loaded`, "success");
        }
      } catch (err) {
        showToast("Failed to load preset", "error");
      }
    });
  }

  /** Show a custom prompt modal. Returns the entered string or null. */
  function showPromptModal(title) {
    return new Promise((resolve) => {
      const overlay = document.getElementById("prompt-modal");
      const input = document.getElementById("prompt-modal-input");
      const titleEl = document.getElementById("prompt-modal-title");
      const okBtn = document.getElementById("prompt-modal-ok");
      const cancelBtn = document.getElementById("prompt-modal-cancel");
      titleEl.textContent = title || "Enter a name";
      input.value = "";
      overlay.classList.remove("hidden");
      input.focus();

      function cleanup(result) {
        overlay.classList.add("hidden");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        input.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onOk() { cleanup(input.value); }
      function onCancel() { cleanup(null); }
      function onKey(e) {
        if (e.key === "Enter") { e.preventDefault(); cleanup(input.value); }
        if (e.key === "Escape") { e.preventDefault(); cleanup(null); }
      }
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      input.addEventListener("keydown", onKey);
    });
  }

  if (btnPresetSave) {
    btnPresetSave.addEventListener("click", async () => {
      const name = await showPromptModal("Preset name");
      if (!name || !name.trim()) return;
      const trimmed = name.trim();
      if (!window.subforge || !window.subforge.savePreset) return;
      try {
        await window.subforge.savePreset(trimmed, gatherStudioSettings());
        await refreshPresetList();
        studioPreset.value = trimmed;
        showToast(`Preset "${trimmed}" saved`, "success");
      } catch (err) {
        showToast("Failed to save preset", "error");
      }
    });
  }

  if (btnPresetDelete) {
    btnPresetDelete.addEventListener("click", async () => {
      const name = studioPreset.value;
      if (!name || !window.subforge || !window.subforge.deletePreset) return;
      try {
        await window.subforge.deletePreset(name);
        await refreshPresetList();
        showToast(`Preset "${name}" deleted`);
      } catch (err) {
        showToast("Failed to delete preset");
      }
    });
  }

  // Load preset list on startup
  refreshPresetList();

  // --- Build word groups from current transcription ---
  function buildStudioGroups() {
    studioGroups = [];
    if (!transcriptionResult || !transcriptionResult.segments) return;

    const wpg = parseInt(studioWpg.value, 10) || 3;
    studioDuration = transcriptionResult.duration || 0;

    transcriptionResult.segments.forEach((seg) => {
      if (!seg.words || seg.words.length === 0) {
        studioGroups.push({
          text: seg.text,
          start: seg.start,
          end: seg.end,
          words: [{ word: seg.text, start: seg.start, end: seg.end }],
        });
        if (seg.end > studioDuration) studioDuration = seg.end;
        return;
      }

      for (let i = 0; i < seg.words.length; i += wpg) {
        const chunk = seg.words.slice(i, i + wpg);
        if (chunk.length === 0) continue;
        const group = {
          text: chunk.map((w) => w.word.trim()).join(" "),
          start: chunk[0].start,
          end: chunk[chunk.length - 1].end,
          words: chunk.map((w) => ({ word: w.word.trim(), start: w.start, end: w.end })),
        };
        studioGroups.push(group);
        if (group.end > studioDuration) studioDuration = group.end;
      }
    });
    // Redraw timeline whenever groups change
    drawTimeline(wavesurfer ? wavesurfer.getCurrentTime() : 0);
  }

  // ============================
  // Group Editor
  // ============================

  // Toggle group editor panel
  if (btnGroupToggle) {
    btnGroupToggle.addEventListener("click", () => {
      groupEditorOpen = !groupEditorOpen;
      btnGroupToggle.classList.toggle("active", groupEditorOpen);
      groupEditorEl.classList.toggle("hidden", !groupEditorOpen);
      resultsPreview.classList.toggle("hidden", groupEditorOpen);
      if (groupEditorOpen) {
        if (!studioGroups.length) buildStudioGroups();
        renderGroupEditor();
      }
    });
  }

  // Timing shift
  if (btnTimingShiftApply && inpTimingShift) {
    btnTimingShiftApply.addEventListener("click", () => {
      const shiftMs = parseFloat(inpTimingShift.value) || 0;
      if (shiftMs === 0) return;
      const shiftSec = shiftMs / 1000;
      if (!transcriptionResult) return;
      _pushUndo();
      // Shift all segments and their words
      transcriptionResult.segments = transcriptionResult.segments.map(seg => ({
        ...seg,
        start: Math.max(0, seg.start + shiftSec),
        end:   Math.max(0, seg.end   + shiftSec),
        words: (seg.words || []).map(w => ({
          ...w,
          start: Math.max(0, w.start + shiftSec),
          end:   Math.max(0, w.end   + shiftSec),
        })),
      }));
      // Rebuild studio groups and re-render
      buildStudioGroups();
      renderGroupEditor();
      renderResults(transcriptionResult);
      drawStudioFrame();
      inpTimingShift.value = "0";
      showToast(`Shifted all subtitles by ${shiftMs > 0 ? "+" : ""}${shiftMs} ms`, "success");
    });
  }

  // Reset button
  if (btnGroupReset) {
    btnGroupReset.addEventListener("click", () => {
      customGroupsEdited = false;
      buildStudioGroups();
      renderGroupEditor();
      drawStudioFrame();
      showToast("Groups reset to auto-grouping");
    });
  }

  // Drag state
  let geDragSourceGroupIdx = null;
  let geDragWordIdx = null;

  function renderGroupEditor() {
    if (!groupEditorList) return;
    groupEditorList.innerHTML = "";

    studioGroups.forEach((group, gi) => {
      // Merge button row (between groups)
      if (gi > 0) {
        const mergeRow = document.createElement("div");
        mergeRow.className = "ge-merge-row";
        const mergeBtn = document.createElement("button");
        mergeBtn.className = "ge-merge-btn";
        mergeBtn.textContent = "⬆ merge ⬇";
        mergeBtn.title = "Merge with group above";
        mergeBtn.addEventListener("click", () => mergeGroups(gi - 1, gi));
        mergeRow.appendChild(mergeBtn);
        groupEditorList.appendChild(mergeRow);
      }

      const row = document.createElement("div");
      row.className = "ge-row";
      row.dataset.groupIndex = gi;

      // Index
      const idx = document.createElement("span");
      idx.className = "ge-index";
      idx.textContent = `#${gi + 1}`;
      row.appendChild(idx);

      // Time
      const time = document.createElement("span");
      time.className = "ge-time";
      time.textContent = `${formatTime(group.start)} → ${formatTime(group.end)}`;
      time.addEventListener("click", () => seekTo(group.start));
      row.appendChild(time);

      // Words container (droppable)
      const wordsEl = document.createElement("div");
      wordsEl.className = "ge-words";
      wordsEl.dataset.groupIndex = gi;

      wordsEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        wordsEl.classList.add("ge-dragover");
      });
      wordsEl.addEventListener("dragleave", () => {
        wordsEl.classList.remove("ge-dragover");
      });
      wordsEl.addEventListener("drop", (e) => {
        e.preventDefault();
        wordsEl.classList.remove("ge-dragover");
        const srcGroup = parseInt(e.dataTransfer.getData("text/ge-group"), 10);
        const srcWord = parseInt(e.dataTransfer.getData("text/ge-word"), 10);
        if (isNaN(srcGroup) || isNaN(srcWord)) return;
        moveWord(srcGroup, srcWord, gi);
      });

      group.words.forEach((w, wi) => {
        // Split button between words (not before first)
        if (wi > 0) {
          const splitBtn = document.createElement("button");
          splitBtn.className = "ge-split-btn";
          splitBtn.textContent = "✂";
          splitBtn.title = "Split group here";
          splitBtn.addEventListener("click", () => splitGroup(gi, wi));
          wordsEl.appendChild(splitBtn);
        }

        const chip = document.createElement("span");
        chip.className = "ge-word" + (w.overrides ? " ge-word-styled" : "");
        chip.textContent = w.word;
        chip.draggable = true;
        chip.dataset.groupIndex = gi;
        chip.dataset.wordIndex = wi;
        if (w.overrides?.text_color) chip.style.color = w.overrides.text_color;

        chip.addEventListener("dragstart", (e) => {
          geDragSourceGroupIdx = gi;
          geDragWordIdx = wi;
          e.dataTransfer.setData("text/ge-group", String(gi));
          e.dataTransfer.setData("text/ge-word", String(wi));
          e.dataTransfer.effectAllowed = "move";
          chip.classList.add("ge-word-dragging");
        });
        chip.addEventListener("dragend", () => {
          chip.classList.remove("ge-word-dragging");
          geDragSourceGroupIdx = null;
          geDragWordIdx = null;
        });

        chip.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openWordStylePopup(e, gi, wi);
        });

        wordsEl.appendChild(chip);
      });

      row.appendChild(wordsEl);

      // Actions
      const actions = document.createElement("div");
      actions.className = "ge-actions";

      if (group.words.length > 1) {
        const splitMidBtn = document.createElement("button");
        splitMidBtn.className = "ge-btn";
        splitMidBtn.title = "Split in half";
        splitMidBtn.innerHTML = "✂ Split";
        splitMidBtn.addEventListener("click", () => {
          const mid = Math.ceil(group.words.length / 2);
          splitGroup(gi, mid);
        });
        actions.appendChild(splitMidBtn);
      }

      row.appendChild(actions);
      groupEditorList.appendChild(row);
    });
  }

  // ---- Word style override popup ----
  let activePopup = null;
  function closeWordStylePopup() {
    if (activePopup) { activePopup.remove(); activePopup = null; }
  }
  document.addEventListener("mousedown", (e) => {
    if (activePopup && !activePopup.contains(e.target)) closeWordStylePopup();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWordStylePopup(); });

  function openWordStylePopup(e, gi, wi) {
    closeWordStylePopup();
    const w = studioGroups[gi].words[wi];
    const ov = w.overrides || {};

    const popup = document.createElement("div");
    popup.className = "word-style-popup";
    activePopup = popup;

    const title = document.createElement("div");
    title.className = "word-style-popup-title";
    title.textContent = `Style: "${w.word}"`;
    popup.appendChild(title);

    function addColorRow(label, key, defaultFn) {
      const row = document.createElement("div");
      row.className = "studio-row";
      const lbl = document.createElement("label");
      lbl.textContent = label;
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = ov[key] || defaultFn();
      const hex = document.createElement("input");
      hex.type = "text";
      hex.className = "hex-input";
      hex.value = picker.value.toUpperCase();
      hex.maxLength = 7;
      picker.addEventListener("input", () => {
        hex.value = picker.value.toUpperCase();
        applyPreview();
      });
      hex.addEventListener("input", () => {
        if (/^#[0-9A-Fa-f]{6}$/.test(hex.value)) { picker.value = hex.value; applyPreview(); }
      });
      row.appendChild(lbl); row.appendChild(picker); row.appendChild(hex);
      popup.appendChild(row);
      return { get: () => picker.value };
    }

    function addScaleRow() {
      const row = document.createElement("div");
      row.className = "studio-row";
      const lbl = document.createElement("label");
      lbl.textContent = "Size Scale";
      const slider = document.createElement("input");
      slider.type = "range"; slider.min = "50"; slider.max = "200"; slider.value = Math.round((ov.font_size_scale || 1) * 100);
      const num = document.createElement("input");
      num.type = "number"; num.className = "range-num"; num.value = slider.value;
      slider.addEventListener("input", () => { num.value = slider.value; applyPreview(); });
      num.addEventListener("change", () => {
        const v = parseFloat(num.value);
        if (!isNaN(v)) { slider.value = v; num.value = v; applyPreview(); }
      });
      row.appendChild(lbl); row.appendChild(slider); row.appendChild(num);
      popup.appendChild(row);
      return { get: () => parseInt(slider.value, 10) / 100 };
    }

    function addBoldRow() {
      const row = document.createElement("div");
      row.className = "studio-row";
      const lbl = document.createElement("label");
      lbl.textContent = "Bold";
      const toggle = document.createElement("label");
      toggle.className = "toggle-switch";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = ov.bold !== undefined ? ov.bold : (studioBold ? studioBold.checked : true);
      const span = document.createElement("span");
      span.className = "toggle-slider";
      toggle.appendChild(cb); toggle.appendChild(span);
      cb.addEventListener("change", () => applyPreview());
      row.appendChild(lbl); row.appendChild(toggle);
      popup.appendChild(row);
      return { get: () => cb.checked };
    }

    function addFontRow() {
      // Font family select — clone options from the global font dropdown
      const row = document.createElement("div");
      row.className = "studio-row";
      const lbl = document.createElement("label");
      lbl.textContent = "Font";
      const sel = document.createElement("select");
      sel.style.flex = "1";
      sel.style.fontSize = "11px";
      // "Global" sentinel = use global setting
      const globalOpt = document.createElement("option");
      globalOpt.value = ""; globalOpt.textContent = "— Global —";
      sel.appendChild(globalOpt);
      if (studioFont) {
        Array.from(studioFont.options).forEach(o => {
          const opt = document.createElement("option");
          opt.value = o.value; opt.textContent = o.textContent;
          if (o.dataset.customPath) opt.dataset.customPath = o.dataset.customPath;
          sel.appendChild(opt);
        });
      }
      sel.value = ov.font_family || "";
      sel.addEventListener("change", () => applyPreview());

      // Custom font load button
      const loadBtn = document.createElement("button");
      loadBtn.textContent = "＋";
      loadBtn.title = "Load custom font for this word";
      loadBtn.style.cssText = "flex-shrink:0;padding:2px 6px;font-size:13px;cursor:pointer;border:1px solid var(--border);border-radius:4px;background:var(--bg-tertiary);color:var(--text)";
      const fileIn = document.createElement("input");
      fileIn.type = "file"; fileIn.accept = ".ttf,.otf,.woff"; fileIn.style.display = "none";
      loadBtn.addEventListener("click", () => fileIn.click());
      fileIn.addEventListener("change", async () => {
        const file = fileIn.files[0]; if (!file) return;
        const fontName = file.name.replace(/\.[^.]+$/, "");
        try {
          const buf = await file.arrayBuffer();
          const face = new FontFace(fontName, buf);
          await face.load(); document.fonts.add(face);
          // Also add to global dropdown so backend can find the path
          let savedPath = null;
          if (window.subforge && window.subforge.saveFont) {
            savedPath = await window.subforge.saveFont(file.name, buf).catch(() => null);
          }
          addFontToDropdown(fontName, savedPath);
          // Add to this popup's select too
          const opt = document.createElement("option");
          opt.value = fontName; opt.textContent = fontName + " ★";
          if (savedPath) opt.dataset.customPath = savedPath;
          sel.appendChild(opt);
          sel.value = fontName;
          applyPreview();
        } catch (e) { showToast("Font load failed: " + e.message, "error"); }
      });
      row.appendChild(lbl); row.appendChild(sel); row.appendChild(loadBtn); row.appendChild(fileIn);
      popup.appendChild(row);
      return {
        getFamily: () => sel.value || null,
        getPath: () => {
          const opt = sel.options[sel.selectedIndex];
          return (opt && opt.dataset.customPath) || null;
        },
      };
    }

    function addTransitionRow() {
      const row = document.createElement("div");
      row.className = "studio-row";
      const lbl = document.createElement("label");
      lbl.textContent = "Animation";
      const sel = document.createElement("select");
      sel.style.flex = "1"; sel.style.fontSize = "11px";
      [["", "— Global —"], ["instant","Instant"], ["crossfade","Crossfade"],
       ["highlight","Highlight"], ["underline","Underline"],
       ["bounce","Bounce"], ["scale","Scale Up"], ["karaoke","Karaoke"]
      ].forEach(([v, t]) => {
        const o = document.createElement("option");
        o.value = v; o.textContent = t; sel.appendChild(o);
      });
      sel.value = ov.word_transition || "";
      sel.addEventListener("change", () => applyPreview());
      row.appendChild(lbl); row.appendChild(sel);
      popup.appendChild(row);
      return { get: () => sel.value || null };
    }

    const textColorCtrl   = addColorRow("Text Color",   "text_color",        () => studioTextColor  ? studioTextColor.value  : "#FFFFFF");
    const activeColorCtrl = addColorRow("Active Color", "active_word_color", () => studioActiveColor ? studioActiveColor.value : "#FFD700");
    const scaleCtrl       = addScaleRow();
    const boldCtrl        = addBoldRow();
    const fontCtrl        = addFontRow();
    const transitionCtrl  = addTransitionRow();

    function applyPreview() {
      const tc  = textColorCtrl.get();
      const ac  = activeColorCtrl.get();
      const sc  = scaleCtrl.get();
      const bd  = boldCtrl.get();
      const ff  = fontCtrl.getFamily();
      const fp  = fontCtrl.getPath();
      const wt  = transitionCtrl.get();
      const globalTc = studioTextColor  ? studioTextColor.value  : "#FFFFFF";
      const globalAc = studioActiveColor ? studioActiveColor.value : "#FFD700";
      const globalBd = studioBold ? studioBold.checked : true;
      const hasOverride = tc !== globalTc || ac !== globalAc || sc !== 1 || bd !== globalBd || ff || wt;
      if (hasOverride) {
        w.overrides = { text_color: tc, active_word_color: ac, font_size_scale: sc, bold: bd };
        if (ff) { w.overrides.font_family = ff; if (fp) w.overrides.custom_font_path = fp; }
        if (wt) w.overrides.word_transition = wt;
      }
      customGroupsEdited = true;
      drawStudioFrame();
    }

    const footer = document.createElement("div");
    footer.className = "word-style-popup-footer";

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => { applyPreview(); closeWordStylePopup(); renderGroupEditor(); });

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.className = "btn-clear-override";
    clearBtn.addEventListener("click", () => {
      delete w.overrides;
      customGroupsEdited = true;
      closeWordStylePopup();
      renderGroupEditor();
      drawStudioFrame();
    });

    footer.appendChild(clearBtn);
    footer.appendChild(applyBtn);
    popup.appendChild(footer);

    document.body.appendChild(popup);

    // Position near the click, keep on screen
    const pw = popup.offsetWidth || 240, ph = popup.offsetHeight || 200;
    let px = e.clientX + 8, py = e.clientY + 8;
    if (px + pw > window.innerWidth - 10) px = e.clientX - pw - 8;
    if (py + ph > window.innerHeight - 10) py = e.clientY - ph - 8;
    popup.style.left = px + "px";
    popup.style.top  = py + "px";
  }

  function mergeGroups(idxA, idxB) {
    if (idxA < 0 || idxB >= studioGroups.length) return;
    const a = studioGroups[idxA];
    const b = studioGroups[idxB];
    const merged = {
      text: a.words.concat(b.words).map((w) => w.word).join(" "),
      start: a.start,
      end: b.end,
      words: a.words.concat(b.words),
    };
    studioGroups.splice(idxA, 2, merged);
    customGroupsEdited = true;
    renderGroupEditor();
    drawStudioFrame();
  }

  function splitGroup(groupIdx, afterWordIdx) {
    const group = studioGroups[groupIdx];
    if (!group || afterWordIdx <= 0 || afterWordIdx >= group.words.length) return;

    const wordsA = group.words.slice(0, afterWordIdx);
    const wordsB = group.words.slice(afterWordIdx);

    const groupA = {
      text: wordsA.map((w) => w.word).join(" "),
      start: wordsA[0].start,
      end: wordsA[wordsA.length - 1].end,
      words: wordsA,
    };
    const groupB = {
      text: wordsB.map((w) => w.word).join(" "),
      start: wordsB[0].start,
      end: wordsB[wordsB.length - 1].end,
      words: wordsB,
    };

    studioGroups.splice(groupIdx, 1, groupA, groupB);
    customGroupsEdited = true;
    renderGroupEditor();
    drawStudioFrame();
  }

  function moveWord(srcGroupIdx, wordIdx, destGroupIdx) {
    if (srcGroupIdx === destGroupIdx) return;
    const srcGroup = studioGroups[srcGroupIdx];
    if (!srcGroup || wordIdx < 0 || wordIdx >= srcGroup.words.length) return;

    const word = srcGroup.words[wordIdx];

    // Remove from source
    srcGroup.words.splice(wordIdx, 1);
    srcGroup.text = srcGroup.words.map((w) => w.word).join(" ");

    // Add to destination
    const destGroup = studioGroups[destGroupIdx];

    // Determine insertion position based on timing
    if (destGroupIdx < srcGroupIdx) {
      // Moving up — add to end
      destGroup.words.push(word);
    } else {
      // Moving down — add to start
      destGroup.words.unshift(word);
    }
    destGroup.text = destGroup.words.map((w) => w.word).join(" ");

    // Update timings
    if (srcGroup.words.length > 0) {
      srcGroup.start = srcGroup.words[0].start;
      srcGroup.end = srcGroup.words[srcGroup.words.length - 1].end;
    }
    destGroup.start = destGroup.words[0].start;
    destGroup.end = destGroup.words[destGroup.words.length - 1].end;

    // Remove empty groups
    if (srcGroup.words.length === 0) {
      studioGroups.splice(srcGroupIdx, 1);
    }

    customGroupsEdited = true;
    renderGroupEditor();
    drawStudioFrame();
  }

  function highlightActiveGroup(t) {
    if (!groupEditorList) return;
    const rows = groupEditorList.querySelectorAll(".ge-row");
    rows.forEach((row) => {
      const gi = parseInt(row.dataset.groupIndex, 10);
      const g = studioGroups[gi];
      if (g && g.start <= t && t < g.end) {
        row.classList.add("ge-row-active");
        // Also highlight active word chip
        row.querySelectorAll(".ge-word").forEach((chip) => {
          const wi = parseInt(chip.dataset.wordIndex, 10);
          const w = g.words[wi];
          chip.classList.toggle("ge-word-active", w && w.start <= t && t < w.end);
        });
      } else {
        row.classList.remove("ge-row-active");
        row.querySelectorAll(".ge-word").forEach((c) => c.classList.remove("ge-word-active"));
      }
    });
  }

  function drawStudioFrame() {
    drawSubtitleOverlay(studioScrubTime);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // --- Subtitle Timeline ---

  const TIMELINE_RULER_H = 18;
  const TIMELINE_TRACK_H = 48;
  const TIMELINE_H = TIMELINE_RULER_H + TIMELINE_TRACK_H;

  function niceTimeStep(duration, widthPx) {
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const target = widthPx / 80; // aim for ~80px between marks
    const ideal = duration / target;
    for (const s of steps) { if (s >= ideal) return s; }
    return steps[steps.length - 1];
  }

  function drawTimeline(currentTime) {
    if (!timelineCanvas || !timelineCtx) return;
    const wrap = document.getElementById("timeline-wrap");
    if (!wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth || 600;
    const cssH = TIMELINE_H;
    const bW = Math.round(cssW * dpr);
    const bH = Math.round(cssH * dpr);
    if (timelineCanvas.width !== bW || timelineCanvas.height !== bH) {
      timelineCanvas.width  = bW;
      timelineCanvas.height = bH;
      timelineCanvas.style.width  = cssW + "px";
      timelineCanvas.style.height = cssH + "px";
    }

    const ctx = timelineCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const duration = wavesurfer ? wavesurfer.getDuration() : 0;
    if (!duration) return;
    // Viewport: at zoom=1, entire duration fits. At zoom=N, we see duration/N.
    const visibleDur = duration / _tlZoom;
    // Clamp scroll so we never pan past the ends
    _tlScrollT = Math.max(0, Math.min(_tlScrollT, Math.max(0, duration - visibleDur)));
    const viewT0 = _tlScrollT;
    const viewT1 = viewT0 + visibleDur;
    const pps = cssW / visibleDur; // pixels per second within viewport
    const tToX = (t) => (t - viewT0) * pps;

    // ── Ruler background ──
    const isDark = !document.documentElement.classList.contains("light");
    const rulerBg   = isDark ? "#0d1117" : "#eef1f4";
    const trackBg   = isDark ? "#161b22" : "#f6f8fa";
    const rulerText = isDark ? "#8b949e" : "#636c76";
    const tickColor = isDark ? "#30363d" : "#d0d7de";
    const blockBg   = studioBgColor ? studioBgColor.value : "#D4952A";
    const blockText = isDark ? "#ffffff" : "#ffffff";
    const headColor = isDark ? "#58a6ff" : "#0969da";

    ctx.fillStyle = rulerBg;
    ctx.fillRect(0, 0, cssW, TIMELINE_RULER_H);
    ctx.fillStyle = trackBg;
    ctx.fillRect(0, TIMELINE_RULER_H, cssW, TIMELINE_TRACK_H);

    // ── Tick marks + time labels ──
    const step = niceTimeStep(visibleDur, cssW);
    ctx.fillStyle = rulerText;
    ctx.font = `${10 * (dpr > 1 ? 1 : 1)}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = "middle";
    const firstTick = Math.floor(viewT0 / step) * step;
    for (let t = firstTick; t <= viewT1 + 0.001; t += step) {
      const x = Math.round(tToX(t));
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, TIMELINE_RULER_H);
      ctx.stroke();
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      // Sub-second precision at high zoom
      const subSec = step < 1 ? (t % 1).toFixed(step < 0.1 ? 2 : 1).slice(1) : "";
      const label = mins > 0
        ? `${mins}:${String(secs).padStart(2, "0")}${subSec}`
        : `${secs}${subSec}s`;
      ctx.fillStyle = rulerText;
      ctx.fillText(label, x + 3, TIMELINE_RULER_H / 2);
    }

    // ── Subtitle blocks (cull those outside viewport) ──
    const PAD = 3;
    studioGroups.forEach((g) => {
      if (g.end < viewT0 || g.start > viewT1) return;
      const x = tToX(g.start);
      const w = Math.max((g.end - g.start) * pps - 1, 3);
      const y = TIMELINE_RULER_H + PAD;
      const h = TIMELINE_TRACK_H - PAD * 2;
      const r = Math.min(4, h / 2);

      ctx.fillStyle = blockBg;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();

      // Text label: first ~5 words
      if (w > 18) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 5, y, Math.max(w - 10, 1), h);
        ctx.clip();
        ctx.fillStyle = blockText;
        ctx.font = `bold 11px -apple-system, "Segoe UI", sans-serif`;
        ctx.textBaseline = "middle";
        const label = g.words.slice(0, 5).map(ww => ww.word).join(" ").trim()
          || g.text.trim().split(/\s+/).slice(0, 5).join(" ");
        ctx.fillText(label, x + 5, y + h / 2);
        ctx.restore();
      }
    });

    // ── Playhead ──
    if (currentTime != null && duration > 0 && currentTime >= viewT0 && currentTime <= viewT1) {
      const px = tToX(currentTime);
      ctx.strokeStyle = headColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cssH);
      ctx.stroke();
      // Triangle handle
      ctx.fillStyle = headColor;
      ctx.beginPath();
      ctx.moveTo(px - 5, 0);
      ctx.lineTo(px + 5, 0);
      ctx.lineTo(px, 7);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Timeline interactions: click-to-seek + edge-drag to adjust segment timing
  if (timelineCanvas) {
    const EDGE_HIT = 6; // px tolerance for edge detection
    let _tlDrag = null; // { groupIdx, edge: "start"|"end"|null, startX, origVal }

    function _tlTimeAtX(clientX) {
      if (!wavesurfer) return 0;
      const rect = timelineCanvas.getBoundingClientRect();
      const duration = wavesurfer.getDuration() || 0;
      const visibleDur = duration / _tlZoom;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return _tlScrollT + ratio * visibleDur;
    }

    function _tlFindEdge(clientX) {
      if (!wavesurfer || !wavesurfer.getDuration()) return null;
      const rect = timelineCanvas.getBoundingClientRect();
      const duration = wavesurfer.getDuration();
      const visibleDur = duration / _tlZoom;
      const pps = rect.width / visibleDur;
      const t = _tlTimeAtX(clientX);
      for (let i = 0; i < studioGroups.length; i++) {
        const g = studioGroups[i];
        const startPx = (g.start - _tlScrollT) * pps + rect.left;
        const endPx   = (g.end   - _tlScrollT) * pps + rect.left;
        if (Math.abs(clientX - startPx) <= EDGE_HIT) return { groupIdx: i, edge: "start" };
        if (Math.abs(clientX - endPx)   <= EDGE_HIT) return { groupIdx: i, edge: "end" };
        // Inside block body
        if (t >= g.start && t <= g.end) return { groupIdx: i, edge: null };
      }
      return null;
    }

    function _tlUpdateZoomLabel() {
      if (tlZoomLabel) tlZoomLabel.textContent = Math.round(_tlZoom * 100) + "%";
    }

    function _tlSetZoom(newZoom, anchorClientX) {
      const duration = wavesurfer ? wavesurfer.getDuration() : 0;
      if (!duration) return;
      const clamped = Math.max(TL_ZOOM_MIN, Math.min(TL_ZOOM_MAX, newZoom));
      // Keep the time under anchorClientX fixed while zooming
      let anchorT = _tlScrollT + duration / _tlZoom / 2;
      if (anchorClientX != null) {
        const rect = timelineCanvas.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (anchorClientX - rect.left) / rect.width));
        anchorT = _tlScrollT + ratio * (duration / _tlZoom);
      }
      _tlZoom = clamped;
      const newVisible = duration / _tlZoom;
      // Anchor at same screen ratio
      if (anchorClientX != null) {
        const rect = timelineCanvas.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (anchorClientX - rect.left) / rect.width));
        _tlScrollT = anchorT - ratio * newVisible;
      } else {
        _tlScrollT = anchorT - newVisible / 2;
      }
      _tlScrollT = Math.max(0, Math.min(_tlScrollT, Math.max(0, duration - newVisible)));
      _tlUpdateZoomLabel();
      drawTimeline(wavesurfer ? wavesurfer.getCurrentTime() : 0);
    }

    timelineCanvas.addEventListener("wheel", (e) => {
      if (!wavesurfer || !wavesurfer.getDuration()) return;
      if (e.ctrlKey || e.metaKey) {
        // Zoom centered on cursor
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        _tlSetZoom(_tlZoom * factor, e.clientX);
      } else {
        // Pan horizontally (support both vertical and horizontal wheel deltas)
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        e.preventDefault();
        const duration = wavesurfer.getDuration();
        const visibleDur = duration / _tlZoom;
        _tlScrollT = Math.max(0, Math.min(
          duration - visibleDur,
          _tlScrollT + (delta / timelineCanvas.clientWidth) * visibleDur
        ));
        drawTimeline(wavesurfer.getCurrentTime());
      }
    }, { passive: false });

    if (btnTlZoomIn)  btnTlZoomIn .addEventListener("click", () => _tlSetZoom(_tlZoom * 1.5, null));
    if (btnTlZoomOut) btnTlZoomOut.addEventListener("click", () => _tlSetZoom(_tlZoom / 1.5, null));
    if (btnTlFit) btnTlFit.addEventListener("click", () => {
      _tlZoom = 1;
      _tlScrollT = 0;
      _tlUpdateZoomLabel();
      drawTimeline(wavesurfer ? wavesurfer.getCurrentTime() : 0);
    });

    timelineCanvas.addEventListener("mousemove", (e) => {
      if (_tlDrag) {
        const t = _tlTimeAtX(e.clientX);
        const g = studioGroups[_tlDrag.groupIdx];
        // Neighbor bounds — caption blocks can't overlap each other
        const prev = studioGroups[_tlDrag.groupIdx - 1];
        const next = studioGroups[_tlDrag.groupIdx + 1];
        const GAP = 0.01; // 10ms minimum gap between adjacent blocks
        if (_tlDrag.edge === "start") {
          const minStart = prev ? prev.end + GAP : 0;
          g.start = Math.max(minStart, Math.min(t, g.end - 0.05));
          customGroupsEdited = true;
        } else if (_tlDrag.edge === "end") {
          const duration = wavesurfer ? wavesurfer.getDuration() : Infinity;
          const maxEnd = next ? next.start - GAP : duration;
          g.end = Math.min(maxEnd, Math.max(g.start + 0.05, t));
          customGroupsEdited = true;
        } else {
          // Body drag → seek
          wavesurfer.seekTo(Math.max(0, Math.min(1, t / (wavesurfer.getDuration() || 1))));
        }
        drawTimeline(studioScrubTime);
        return;
      }
      const hit = _tlFindEdge(e.clientX);
      timelineCanvas.style.cursor = hit
        ? (hit.edge ? "ew-resize" : "pointer")
        : "default";
    });

    timelineCanvas.addEventListener("mousedown", (e) => {
      const hit = _tlFindEdge(e.clientX);
      if (!hit) return;
      if (hit.edge) {
        _pushUndo();
        e.preventDefault();
        _tlDrag = { groupIdx: hit.groupIdx, edge: hit.edge };
      } else {
        // Body click — seek
        const t = _tlTimeAtX(e.clientX);
        if (wavesurfer && wavesurfer.getDuration()) {
          wavesurfer.seekTo(t / wavesurfer.getDuration());
        }
      }
    });

    window.addEventListener("mouseup", () => {
      if (_tlDrag && _tlDrag.edge) {
        // Re-render group editor to reflect timing changes
        renderGroupEditor();
        drawStudioFrame();
      }
      _tlDrag = null;
    });

    timelineCanvas.addEventListener("mouseleave", () => {
      if (!_tlDrag) timelineCanvas.style.cursor = "default";
    });
  }

  // --- Subtitle overlay on main video/audio player ---
  function drawSubtitleOverlay(currentTime) {
    if (!subtitleOverlay || !subtitleOverlayCtx) return;

    // Always clear first so no stale caption stays painted when there is nothing to show.
    const [resW, resH] = studioResolution.value.split("x").map(Number);
    if (subtitleOverlay.width !== resW || subtitleOverlay.height !== resH) {
      subtitleOverlay.width  = resW;
      subtitleOverlay.height = resH;
    }
    subtitleOverlayCtx.clearRect(0, 0, resW, resH);

    if (!studioGroups.length) return;
    const videoWrap = document.getElementById("video-wrap");
    if (!videoWrap) return;

    // Canvas buffer = output resolution coordinate space (matches Python renderer exactly).
    // CSS transform scales the canvas to fit inside the player display area,
    // the same way object-fit:contain works, so positions are 1:1 with the export.
    // Use the video element rect when playing video; otherwise use the audio preview bg.
    const anchorEl = (videoPlayer && !videoPlayer.classList.contains("hidden"))
      ? videoPlayer
      : document.getElementById("audio-preview-bg");
    if (!anchorEl || anchorEl.classList.contains("hidden")) return;
    const rect = anchorEl.getBoundingClientRect();
    const cssScale = Math.min(rect.width / resW, rect.height / resH);
    const cssOX    = (rect.width  - resW * cssScale) / 2;
    const cssOY    = (rect.height - resH * cssScale) / 2;
    subtitleOverlay.style.width           = resW + "px";
    subtitleOverlay.style.height          = resH + "px";
    subtitleOverlay.style.transformOrigin = "0 0";
    subtitleOverlay.style.transform       = `translate(${cssOX}px,${cssOY}px) scale(${cssScale})`;
    subtitleOverlay.classList.remove("hidden");

    const ctx = subtitleOverlayCtx;
    // Find active group
    const t = currentTime;
    let activeGroup = null;
    for (const g of studioGroups) {
      if (g.start <= t && t < g.end) { activeGroup = g; break; }
    }
    if (!activeGroup) return;

    // Read styles from studio controls — use *Val number inputs so out-of-slider-range values work
    const fontSize = parseInt(studioFontSizeVal ? studioFontSizeVal.value : studioFontSize.value, 10);
    const fontFamily = studioFont.value;
    const textColor = studioTextColor.value;
    const activeColor = studioActiveColor.value;
    const bgColor = studioBgColor.value;
    const bgOpacity = parseInt(studioBgOpacityVal ? studioBgOpacityVal.value : studioBgOpacity.value, 10) / 100;
    const padH = parseInt(studioPadHVal ? studioPadHVal.value : studioPadH.value, 10);
    const padV = parseInt(studioPadVVal ? studioPadVVal.value : studioPadV.value, 10);
    const radius = parseInt(studioRadiusVal ? studioRadiusVal.value : studioRadius.value, 10);
    const posX = studioPosX ? parseInt(studioPosXVal ? studioPosXVal.value : studioPosX.value, 10) / 100 : 0.5;
    const posY = parseInt(studioPosYVal ? studioPosYVal.value : studioPosY.value, 10) / 100;
    const bgWidthExtra  = studioBgWidthExtraVal  ? parseInt(studioBgWidthExtraVal.value,  10) : (studioBgWidthExtra  ? parseInt(studioBgWidthExtra.value,  10) : 0);
    const bgHeightExtra = studioBgHeightExtraVal ? parseInt(studioBgHeightExtraVal.value, 10) : (studioBgHeightExtra ? parseInt(studioBgHeightExtra.value, 10) : 0);
    const textOffsetX   = studioTextOffsetXVal   ? parseInt(studioTextOffsetXVal.value,   10) : (studioTextOffsetX   ? parseInt(studioTextOffsetX.value,   10) : 0);
    const textOffsetY   = studioTextOffsetYVal   ? parseInt(studioTextOffsetYVal.value,   10) : (studioTextOffsetY   ? parseInt(studioTextOffsetY.value,   10) : 0);
    const isBold = studioBold ? studioBold.checked : true;
    const tracking = parseInt(studioTrackingVal ? studioTrackingVal.value : (studioTracking ? studioTracking.value : "0"), 10);
    const extraWordSpacing = parseInt(studioWordSpacingVal ? studioWordSpacingVal.value : (studioWordSpacing ? studioWordSpacing.value : "0"), 10);
    const strokeWidth = parseInt(studioStrokeWidthVal ? studioStrokeWidthVal.value : (studioStrokeWidth ? studioStrokeWidth.value : "0"), 10);
    const strokeColor = studioStrokeColor ? studioStrokeColor.value : "#000000";
    const shadowEnabled = studioShadowEnabled ? studioShadowEnabled.checked : false;
    const shadowColor   = studioShadowColor   ? studioShadowColor.value : "#000000";
    const shadowOpacity = studioShadowOpacityVal ? parseInt(studioShadowOpacityVal.value, 10) / 100 : (studioShadowOpacity ? parseInt(studioShadowOpacity.value, 10) / 100 : 0.8);
    const shadowBlur    = studioShadowBlurVal    ? parseInt(studioShadowBlurVal.value, 10)    : (studioShadowBlur    ? parseInt(studioShadowBlur.value, 10)    : 8);
    const shadowOffsetX = studioShadowOffsetXVal ? parseInt(studioShadowOffsetXVal.value, 10) : (studioShadowOffsetX ? parseInt(studioShadowOffsetX.value, 10) : 3);
    const shadowOffsetY = studioShadowOffsetYVal ? parseInt(studioShadowOffsetYVal.value, 10) : (studioShadowOffsetY ? parseInt(studioShadowOffsetY.value, 10) : 3);
    const animation = studioAnimation ? studioAnimation.value : "none";
    const animDur = studioAnimDurVal ? parseInt(studioAnimDurVal.value, 10) / 100 : (studioAnimDur ? parseInt(studioAnimDur.value, 10) / 100 : 0.12);
    const wordTransition = studioWordTransition ? studioWordTransition.value : "instant";

    // Drawing is in output-resolution coordinates — same space as the Python renderer.
    // CSS transform (set above) handles fitting the canvas into the display area.
    const sf = fontSize;
    const sp = padH;
    const sv = padV;
    const sr = radius;
    const sTracking = tracking;
    const sWordSpacing = extraWordSpacing;
    const sStroke = strokeWidth;

    // Animation: compute alpha and y-slide offset
    function easeOut(v) { v = Math.max(0, Math.min(1, v)); return 1 - (1 - v) ** 2; }
    const age       = t - activeGroup.start;
    const remaining = activeGroup.end - t;
    const entryT = animDur > 0 ? easeOut(age       / animDur) : 1;
    const exitT  = animDur > 0 ? easeOut(remaining / animDur) : 1;
    const phaseT = Math.min(entryT, exitT);

    let animAlpha = 1;
    let slideOffset = 0;
    let popScale = 1;

    if (animation === "fade") {
      animAlpha = phaseT;
    } else if (animation === "slide") {
      animAlpha = phaseT;
      const slidePx = resH * 0.04;
      slideOffset = entryT < 1 ? slidePx * (1 - entryT) : slidePx * (1 - exitT) * -1;
    } else if (animation === "pop") {
      animAlpha = phaseT;
      if (entryT < 1) popScale = 0.85 + 0.15 * entryT;
    }

    // Colour helpers
    function hexToRgb(hex) {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function lerpColor(c1, c2, lt) {
      return `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * lt)).join(",")})`;
    }
    const CROSSFADE_DUR   = 0.06;
    const hlRadius        = wsoHighlightRadius  ? parseInt(wsoHighlightRadius.value,  10) : 16;
    const hlPaddingX      = wsoHighlightPaddingX ? parseInt(wsoHighlightPaddingX.value, 10) : 6;
    const hlPaddingY      = wsoHighlightPaddingY ? parseInt(wsoHighlightPaddingY.value, 10) : 6;
    const hlOpacity       = wsoHighlightOpacity ? parseInt(wsoHighlightOpacity.value, 10) / 100 : 0.85;
    const hlAnim          = wsoHighlightAnim    ? wsoHighlightAnim.value : "jump";
    const ulThickness     = wsoUnderlineThick   ? parseInt(wsoUnderlineThick.value,  10) : 4;
    const ulColor         = wsoUnderlineColor   ? wsoUnderlineColor.value : activeColor;
    const bounceStrength  = wsoBounceStrength   ? parseInt(wsoBounceStrength.value,  10) / 100    : 0.18;
    const scaleFactor     = wsoScaleFactor      ? parseInt(wsoScaleFactor.value,     10) / 100    : 1.25;
    const BOUNCE_PX  = sf * bounceStrength;
    const SCALE_WORD = scaleFactor;

    // helper: draw one word (or char-by-char) at (wx, wy) with current ctx styles
    function drawWord(word, wx, wy) {
      if (shadowEnabled) {
        const [sr2, sg2, sb2] = hexToRgb(shadowColor);
        ctx.shadowColor   = `rgba(${sr2},${sg2},${sb2},${shadowOpacity})`;
        ctx.shadowBlur    = shadowBlur;
        ctx.shadowOffsetX = shadowOffsetX;
        ctx.shadowOffsetY = shadowOffsetY;
      }
      if (sTracking === 0) {
        if (sStroke > 0) { ctx.strokeText(word, wx, wy); }
        ctx.fillText(word, wx, wy);
      } else {
        let cx2 = wx;
        for (let ci = 0; ci < word.length; ci++) {
          const ch2 = word[ci];
          if (sStroke > 0) { ctx.strokeText(ch2, cx2, wy); }
          ctx.fillText(ch2, cx2, wy);
          cx2 += ctx.measureText(ch2).width + sTracking;
        }
      }
      if (shadowEnabled) {
        ctx.shadowColor   = "transparent";
        ctx.shadowBlur    = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
    }

    const fontWeight = isBold ? "bold" : "normal";
    ctx.font = `${fontWeight} ${sf}px "${fontFamily}", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    function measureWithTracking(text) {
      if (sTracking === 0) return ctx.measureText(text).width;
      let w = 0;
      for (let ci = 0; ci < text.length; ci++) {
        w += ctx.measureText(text[ci]).width;
        if (ci < text.length - 1) w += sTracking;
      }
      return w;
    }

    const baseSpaceW = ctx.measureText(" ").width;
    const effectiveSpaceW = baseSpaceW + sWordSpacing;
    const wm = activeGroup.words.map((w) => {
      // If word has a font_size_scale override, measure at the scaled font size
      const scale = w.overrides?.font_size_scale || 1;
      if (scale !== 1) {
        const ow = w.overrides.bold !== undefined ? (w.overrides.bold ? "bold" : "normal") : fontWeight;
        ctx.font = `${ow} ${sf * scale}px "${fontFamily}", sans-serif`;
      }
      const width = measureWithTracking(w.word);
      if (scale !== 1) ctx.font = `${fontWeight} ${sf}px "${fontFamily}", sans-serif`; // restore
      return { word: w.word, width, start: w.start, end: w.end, overrides: w.overrides || null };
    });

    // Split words into rows
    const numLines = studioLinesVal ? Math.max(1, parseInt(studioLinesVal.value, 10)) : 1;
    const rowLineGap = sf * 0.3; // gap between rows
    const rows = [];
    if (numLines <= 1) {
      rows.push(wm);
    } else {
      const wordsPerRow = Math.ceil(wm.length / numLines);
      for (let r = 0; r < numLines; r++) {
        const slice = wm.slice(r * wordsPerRow, (r + 1) * wordsPerRow);
        if (slice.length > 0) rows.push(slice);
      }
    }

    // Per-row widths; bg sized to widest row
    const rowWidths = rows.map(row => {
      let w = 0; row.forEach((m, i) => { w += m.width; if (i < row.length - 1) w += effectiveSpaceW; }); return w;
    });
    const maxRowW = Math.max(...rowWidths);

    const bgW = maxRowW + sp * 2 + bgWidthExtra;
    const totalTextH = rows.length * sf + (rows.length - 1) * rowLineGap;
    const bgH = totalTextH + sv * 2 + bgHeightExtra;
    const cx = resW * posX;
    const cy = resH * posY + slideOffset;
    const textCx = cx + textOffsetX;
    const textCy = cy + textOffsetY;

    // Apply pop scale transform around the subtitle centre
    if (popScale !== 1) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(popScale, popScale);
      ctx.translate(-cx, -cy);
    }

    if (bgOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = bgOpacity * animAlpha;
      ctx.fillStyle = bgColor;
      roundRect(ctx, cx - bgW / 2, cy - bgH / 2, bgW, bgH, sr);
      ctx.fill();
      ctx.restore();
    }

    // Pre-compute each word's absolute x and y (multi-row aware)
    const wordXPos = [];
    const wordYPos = [];
    rows.forEach((row, ri) => {
      const rowY = textCy - totalTextH / 2 + sf / 2 + ri * (sf + rowLineGap);
      let wx = textCx - rowWidths[ri] / 2;
      row.forEach((m) => { wordXPos.push(wx); wordYPos.push(rowY); wx += m.width + effectiveSpaceW; });
    });

    // Draw highlight pill BEFORE words so text sits on top
    if (wordTransition === "highlight") {
      const activeIdx = wm.findIndex((m) => m.start <= t && t < m.end);
      if (activeIdx >= 0) {
        const m = wm[activeIdx];
        let hlX = wordXPos[activeIdx];
        let hlW = m.width;
        if (hlAnim === "slide" && activeIdx > 0) {
          const wordDur = Math.max(m.end - m.start, 0.001);
          const rawT    = (t - m.start) / wordDur;
          const eased   = 1 - Math.pow(1 - Math.min(rawT * 2.5, 1), 2);
          // only slide within the same row
          if (wordYPos[activeIdx] === wordYPos[activeIdx - 1]) {
            hlX = wordXPos[activeIdx - 1] + (wordXPos[activeIdx] - wordXPos[activeIdx - 1]) * eased;
            hlW = wm[activeIdx - 1].width  + (m.width - wm[activeIdx - 1].width) * eased;
          }
        }
        const hlY = wordYPos[activeIdx];
        ctx.save();
        ctx.globalAlpha = animAlpha * hlOpacity;
        ctx.fillStyle = activeColor;
        roundRect(ctx, hlX - hlPaddingX, hlY - sf / 2 - hlPaddingY, hlW + hlPaddingX * 2, sf + hlPaddingY * 2, hlRadius);
        ctx.fill();
        ctx.restore();
      }
    }

    // Draw words using pre-computed per-word positions
    wm.forEach((m, i) => {
      const x  = wordXPos[i];
      const wy = wordYPos[i];
      const isActive = m.start <= t && t < m.end;
      const wordDur  = Math.max(m.end - m.start, 0.001);
      const wordProg = isActive ? Math.min(Math.max((t - m.start) / wordDur, 0), 1) : 0;

      // Per-word overrides
      const ov = m.overrides;
      const wTextColor    = (ov?.text_color)          || textColor;
      const wActiveColor  = (ov?.active_word_color)   || activeColor;
      const wTextRgb      = hexToRgb(wTextColor);
      const wActiveRgb    = hexToRgb(wActiveColor);
      const wScale        = ov?.font_size_scale || 1;
      const wBold         = ov?.bold !== undefined ? ov.bold : isBold;
      const wFontFamily   = ov?.font_family || fontFamily;
      const wWordTrans    = ov?.word_transition || wordTransition;
      const wSf           = sf * wScale;

      ctx.save();
      ctx.globalAlpha = animAlpha;
      // Apply per-word font if anything differs
      if (wScale !== 1 || wBold !== isBold || wFontFamily !== fontFamily) {
        ctx.font = `${wBold ? "bold" : "normal"} ${wSf}px "${wFontFamily}", sans-serif`;
      }
      if (sStroke > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sStroke * 2;
        ctx.lineJoin = "round";
      }

      // ---- CROSSFADE ----
      if (wWordTrans === "crossfade") {
        const fi = Math.min(Math.max((t - m.start) / CROSSFADE_DUR, 0), 1);
        const fo = Math.min(Math.max((m.end - t)   / CROSSFADE_DUR, 0), 1);
        ctx.fillStyle = lerpColor(wTextRgb, wActiveRgb, fi * fo);
        drawWord(m.word, x, wy);

      // ---- HIGHLIGHT ----
      } else if (wWordTrans === "highlight") {
        ctx.fillStyle = isActive ? bgColor : wTextColor;
        drawWord(m.word, x, wy);

      // ---- UNDERLINE ----
      } else if (wWordTrans === "underline") {
        ctx.fillStyle = isActive ? wActiveColor : wTextColor;
        drawWord(m.word, x, wy);
        if (isActive) {
          const barY = wy + wSf / 2 + 2;
          ctx.fillStyle = ulColor !== activeColor ? ulColor : wActiveColor;
          ctx.fillRect(x, barY, m.width, ulThickness);
        }

      // ---- BOUNCE ----
      } else if (wWordTrans === "bounce") {
        const bounceY = isActive ? wy - BOUNCE_PX * Math.sin(wordProg * Math.PI) : wy;
        ctx.fillStyle = isActive ? wActiveColor : wTextColor;
        drawWord(m.word, x, bounceY);

      // ---- SCALE ----
      } else if (wWordTrans === "scale") {
        if (isActive) {
          const wordCx = x + m.width / 2;
          ctx.translate(wordCx, wy);
          ctx.scale(SCALE_WORD, SCALE_WORD);
          ctx.translate(-wordCx, -wy);
          ctx.fillStyle = wActiveColor;
        } else {
          ctx.fillStyle = wTextColor;
        }
        drawWord(m.word, x, wy);

      // ---- KARAOKE ----
      } else if (wWordTrans === "karaoke") {
        ctx.fillStyle = wTextColor;
        drawWord(m.word, x, wy);
        if (isActive && wordProg > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, wy - wSf, m.width * wordProg, wSf * 2);
          ctx.clip();
          ctx.fillStyle = wActiveColor;
          drawWord(m.word, x, wy);
          ctx.restore();
        }

      // ---- REVEAL ----
      } else if (wWordTrans === "reveal") {
        const hasStarted = t >= m.start;
        if (hasStarted) {
          ctx.fillStyle = isActive ? wActiveColor : wTextColor;
          drawWord(m.word, x, wy);
        }
        // words not yet spoken: draw nothing (invisible)

      // ---- INSTANT (default) ----
      } else {
        ctx.fillStyle = isActive ? wActiveColor : wTextColor;
        drawWord(m.word, x, wy);
      }

      ctx.restore();
    });

    if (popScale !== 1) ctx.restore();
  }

  // --- Render video ---

  // Collapsible custom render section
  if (customRenderToggle && customRenderBody) {
    customRenderToggle.addEventListener("click", () => {
      const open = customRenderBody.classList.toggle("hidden") === false;
      customRenderToggle.classList.toggle("open", open);
    });
  }

  // Quick render buttons
  if (btnRenderBaked) {
    btnRenderBaked.addEventListener("click", () => {
      if (!isVideoFile(selectedFilePath || "")) {
        showToast("Baked mode requires a video source file.", "error");
        return;
      }
      renderSubtitleVideo({ renderMode: "baked", format: "mp4" });
    });
  }
  if (btnRenderOverlay) {
    btnRenderOverlay.addEventListener("click", () => {
      renderSubtitleVideo({ renderMode: "overlay", format: "mov" });
    });
  }

  if (btnRenderVideo) {
    btnRenderVideo.addEventListener("click", () => renderSubtitleVideo());
  }

  if (btnRenderCancel) {
    btnRenderCancel.classList.add("hidden"); // hidden by default, shown while rendering
    btnRenderCancel.addEventListener("click", async () => {
      btnRenderCancel.disabled = true;
      btnRenderCancel.textContent = "Cancelling…";
      try { await api.cancelJob(); } catch { /* ignore */ }
    });
  }

  // Disable "Render Video" quick button when no video source
  function updateQuickRenderState() {
    if (btnRenderBaked) {
      btnRenderBaked.disabled = !selectedFilePath || !isVideoFile(selectedFilePath);
    }
    if (btnRenderOverlay) {
      btnRenderOverlay.disabled = false;
    }
  }

  async function renderSubtitleVideo(overrides = {}) {
    if (!transcriptionResult) {
      showToast("No transcription result. Transcribe a file first.");
      return;
    }

    const renderMode = overrides.renderMode ?? (studioRenderMode ? studioRenderMode.value : "overlay");

    // Baked mode requires the source to be a video file
    if (renderMode === "baked" && (!selectedFilePath || !isVideoFile(selectedFilePath))) {
      showToast("Baked mode requires a video file as source. Please transcribe a video first.");
      return;
    }

    const [resW, resH] = studioResolution.value.split("x").map(Number);

    const config = {
      font_family: studioFont.value,
      custom_font_path: customFontPath || (function() {
        // Safety net: resolve from dropdown option if variable lost
        const sel = studioFont.options[studioFont.selectedIndex];
        return (sel && sel.dataset.customPath) || null;
      })(),
      font_size: parseInt(studioFontSizeVal ? studioFontSizeVal.value : studioFontSize.value, 10),
      bold: studioBold ? studioBold.checked : true,
      tracking: parseInt(studioTrackingVal ? studioTrackingVal.value : (studioTracking ? studioTracking.value : "0"), 10),
      word_spacing: parseInt(studioWordSpacingVal ? studioWordSpacingVal.value : (studioWordSpacing ? studioWordSpacing.value : "0"), 10),
      stroke_width: parseInt(studioStrokeWidthVal ? studioStrokeWidthVal.value : (studioStrokeWidth ? studioStrokeWidth.value : "0"), 10),
      stroke_color: studioStrokeColor ? studioStrokeColor.value : "#000000",
      text_color: studioTextColor.value,
      active_word_color: studioActiveColor.value,
      bg_color: studioBgColor.value,
      bg_opacity: parseInt(studioBgOpacityVal ? studioBgOpacityVal.value : studioBgOpacity.value, 10) / 100,
      bg_padding_h: parseInt(studioPadHVal ? studioPadHVal.value : studioPadH.value, 10),
      bg_padding_v: parseInt(studioPadVVal ? studioPadVVal.value : studioPadV.value, 10),
      bg_corner_radius: parseInt(studioRadiusVal ? studioRadiusVal.value : studioRadius.value, 10),
      bg_width_extra:   studioBgWidthExtraVal  ? parseInt(studioBgWidthExtraVal.value,  10) : (studioBgWidthExtra  ? parseInt(studioBgWidthExtra.value,  10) : 0),
      bg_height_extra:  studioBgHeightExtraVal ? parseInt(studioBgHeightExtraVal.value, 10) : (studioBgHeightExtra ? parseInt(studioBgHeightExtra.value, 10) : 0),
      text_offset_x:    studioTextOffsetXVal   ? parseInt(studioTextOffsetXVal.value,   10) : (studioTextOffsetX   ? parseInt(studioTextOffsetX.value,   10) : 0),
      text_offset_y:    studioTextOffsetYVal   ? parseInt(studioTextOffsetYVal.value,   10) : (studioTextOffsetY   ? parseInt(studioTextOffsetY.value,   10) : 0),
      words_per_group: parseInt(studioWpgVal ? studioWpgVal.value : studioWpg.value, 10),
      lines: parseInt(studioLinesVal ? studioLinesVal.value : (studioLines ? studioLines.value : "1"), 10),
      position_x: studioPosXVal ? parseInt(studioPosXVal.value, 10) / 100 : (studioPosX ? parseInt(studioPosX.value, 10) / 100 : 0.5),
      position_y: parseInt(studioPosYVal ? studioPosYVal.value : studioPosY.value, 10) / 100,
      resolution_w: resW,
      resolution_h: resH,
      fps: parseInt(studioFps.value, 10),
      output_format: overrides.format ?? (renderMode === "baked" ? "mp4" : studioFormat.value),
      render_mode: renderMode,
      video_bitrate: studioBitrate ? studioBitrate.value : "8M",
      animation: studioAnimation ? studioAnimation.value : "none",
      animation_duration: studioAnimDurVal ? parseInt(studioAnimDurVal.value, 10) / 100 : (studioAnimDur ? parseInt(studioAnimDur.value, 10) / 100 : 0.12),
      word_transition: studioWordTransition ? studioWordTransition.value : "instant",
      highlight_radius: wsoHighlightRadiusV ? parseInt(wsoHighlightRadiusV.value, 10) : (wsoHighlightRadius ? parseInt(wsoHighlightRadius.value, 10) : 16),
      highlight_padding_x: wsoHighlightPaddingXV ? parseInt(wsoHighlightPaddingXV.value, 10) : (wsoHighlightPaddingX ? parseInt(wsoHighlightPaddingX.value, 10) : 6),
      highlight_padding_y: wsoHighlightPaddingYV ? parseInt(wsoHighlightPaddingYV.value, 10) : (wsoHighlightPaddingY ? parseInt(wsoHighlightPaddingY.value, 10) : 6),
      highlight_opacity: wsoHighlightOpacityV ? parseInt(wsoHighlightOpacityV.value, 10) / 100 : (wsoHighlightOpacity ? parseInt(wsoHighlightOpacity.value, 10) / 100 : 0.85),
      highlight_animation: wsoHighlightAnim ? wsoHighlightAnim.value : "jump",
      underline_thickness: wsoUnderlineThickV ? parseInt(wsoUnderlineThickV.value, 10) : (wsoUnderlineThick ? parseInt(wsoUnderlineThick.value, 10) : 4),
      underline_color: wsoUnderlineColor ? wsoUnderlineColor.value : "",
      bounce_strength: wsoBounceStrengthV ? parseInt(wsoBounceStrengthV.value, 10) / 100 : (wsoBounceStrength ? parseInt(wsoBounceStrength.value, 10) / 100 : 0.18),
      scale_factor: wsoScaleFactorV ? parseInt(wsoScaleFactorV.value, 10) / 100 : (wsoScaleFactor ? parseInt(wsoScaleFactor.value, 10) / 100 : 1.25),
      shadow_enabled: studioShadowEnabled ? studioShadowEnabled.checked : false,
      shadow_color: studioShadowColor ? studioShadowColor.value : "#000000",
      shadow_opacity: studioShadowOpacityVal ? parseInt(studioShadowOpacityVal.value, 10) / 100 : (studioShadowOpacity ? parseInt(studioShadowOpacity.value, 10) / 100 : 0.8),
      shadow_blur: studioShadowBlurVal ? parseInt(studioShadowBlurVal.value, 10) : (studioShadowBlur ? parseInt(studioShadowBlur.value, 10) : 8),
      shadow_offset_x: studioShadowOffsetXVal ? parseInt(studioShadowOffsetXVal.value, 10) : (studioShadowOffsetX ? parseInt(studioShadowOffsetX.value, 10) : 3),
      shadow_offset_y: studioShadowOffsetYVal ? parseInt(studioShadowOffsetYVal.value, 10) : (studioShadowOffsetY ? parseInt(studioShadowOffsetY.value, 10) : 3),
    };

    [btnRenderVideo, btnRenderBaked, btnRenderOverlay].forEach(b => { if (b) b.disabled = true; });
    if (btnRenderVideo) btnRenderVideo.textContent = "Rendering…";
    renderProgressEl.classList.remove("hidden");
    renderProgressBar.style.width = "0%";
    renderProgressLabel.textContent = "Starting…";
    if (renderElapsedEl) renderElapsedEl.textContent = "";
    if (btnRenderCancel) btnRenderCancel.classList.remove("hidden");
    renderStartTime = Date.now();
    if (renderTimer) clearInterval(renderTimer);
    renderTimer = setInterval(() => {
      if (!renderElapsedEl) return;
      const elapsed = Math.floor((Date.now() - renderStartTime) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      renderElapsedEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }, 1000);

    try {
      const renderBody = {
        config: config,
        output_dir: outputDir,
      };
      if (customGroupsEdited && studioGroups.length > 0) {
        renderBody.custom_groups = studioGroups.map((g) => ({
          text: g.text,
          start: g.start,
          end: g.end,
          words: g.words,
        }));
      }
      const res = await api.renderVideo(renderBody);
      renderProgressBar.style.width = "100%";
      renderProgressLabel.textContent = `Done! ${res.file}`;
      showToast("Subtitle video rendered!", "success");
    } catch (err) {
      const cancelled = err.message && err.message.toLowerCase().includes("cancel");
      renderProgressLabel.textContent = cancelled ? "Cancelled." : `Error: ${err.message}`;
      if (!cancelled) showToast(`Render failed: ${err.message}`, "error");
    } finally {
      if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
      if (btnRenderCancel) {
        btnRenderCancel.classList.add("hidden");
        btnRenderCancel.disabled = false;
        btnRenderCancel.textContent = "Cancel";
      }
      if (btnRenderVideo) {
        btnRenderVideo.disabled = false;
        btnRenderVideo.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 5a.75.75 0 0 1 .4.114l4 2.667a.75.75 0 0 1 0 1.248l-4 2.667A.75.75 0 0 1 5.75 11V5.75A.75.75 0 0 1 6.5 5Z"/></svg> Render with Custom Settings`;
      }
      updateQuickRenderState();
    }
  }

  // Listen for render progress via websocket
  function onRenderProgress(update) {
    if (update.status === "rendering" || update.status === "encoding") {
      renderProgressEl.classList.remove("hidden");
      renderProgressBar.style.width = `${Math.round(update.progress)}%`;
      renderProgressLabel.textContent = update.message;
    }
  }

  // --- Project Save / Open ---

  async function saveProject() {
    if (!transcriptionResult) {
      showToast("Nothing to save — transcribe a file first.");
      return;
    }
    const stem = selectedFilePath
      ? selectedFilePath.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "")
      : "project";

    const projectData = {
      version: 1,
      suggestedName: stem + ".capforge",
      selectedFilePath,
      outputDir,
      transcriptionResult,
      studioSettings: gatherStudioSettings(),
      customGroupsEdited,
      studioGroups: customGroupsEdited ? studioGroups : null,
    };

    try {
      const savedPath = await window.subforge.saveProject(projectData);
      if (savedPath) {
        currentProjectPath = savedPath;
        showToast("Project saved", "success");
      }
    } catch (err) {
      showToast("Failed to save project", "error");
    }
  }

  async function openProject() {
    try {
      const data = await window.subforge.openProject();
      if (!data) return;

      // Restore state
      selectedFilePath = data.selectedFilePath || null;
      outputDir = data.outputDir || "output";
      transcriptionResult = data.transcriptionResult || null;
      currentProjectPath = data._filePath || null;

      if (!transcriptionResult) {
        showToast("Project file contains no transcription data.");
        return;
      }

      // Push transcription result to backend so export/render work
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await api.updateResult(transcriptionResult);
          break;
        } catch (_) {
          // Backend may still be starting — wait and retry
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Rebuild UI
      renderResults(transcriptionResult);
      initAudioPlayer();
      renderExportedFiles([]);

      // Apply studio settings if present
      if (data.studioSettings) {
        applyStudioSettings(data.studioSettings);
      } else {
        buildStudioGroups();
      }

      // Restore custom groups if they were manually edited
      if (data.customGroupsEdited && data.studioGroups) {
        studioGroups = data.studioGroups;
        customGroupsEdited = true;
        renderGroupEditor();
      }

      drawStudioFrame();
      showScreen("results");
      showToast("Project loaded", "success");
    } catch (err) {
      showToast("Failed to open project: " + err.message, "error");
    }
  }

  if (btnProjectSave) btnProjectSave.addEventListener("click", saveProject);
  if (btnProjectOpen) btnProjectOpen.addEventListener("click", openProject);

  // Redraw timeline on resize
  window.addEventListener("resize", () => {
    if (studioGroups.length) drawTimeline(wavesurfer ? wavesurfer.getCurrentTime() : 0);
  });

  // --- Boot ---
  init();
})();
