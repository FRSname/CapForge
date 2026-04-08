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
  const editStatus = document.getElementById("edit-status");

  // Group editor
  const btnGroupToggle = document.getElementById("btn-group-toggle");
  const groupEditorEl = document.getElementById("group-editor");
  const groupEditorList = document.getElementById("group-editor-list");
  const btnGroupReset = document.getElementById("btn-group-reset");

  // --- State ---
  let selectedFilePath = null;
  let outputDir = "output";
  let transcriptionResult = null;
  let wavesurfer = null;
  let currentScreen = "file";
  let editMode = false;
  let hasEdits = false;
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
    btnStart.addEventListener("click", startTranscription);
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

  function onSegmentInput(e) {
    hasEdits = true;
    const row = e.target.closest(".segment-row");
    if (row) row.classList.add("segment-modified");
    editStatus.textContent = "Unsaved changes";
  }

  function onSegmentKeyDown(e) {
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
      showToast("Subtitles saved");
      // Re-render to reflect clean state with updated word spans
      renderResults(transcriptionResult);
      // Refresh groups + preview to reflect edited text
      customGroupsEdited = false;
      buildStudioGroups();
      renderGroupEditor();
      drawStudioFrame();
    } catch (err) {
      showToast("Save failed: " + err.message);
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

    if (isVideo) {
      // Create a fresh <video> element so old WaveSurfer refs can't overwrite it
      const freshVideo = document.createElement("video");
      freshVideo.id = "video-player";
      freshVideo.className = "video-player";
      freshVideo.src = audioSrc;
      const wrap = document.getElementById("video-wrap");
      wrap.replaceChild(freshVideo, videoPlayer);
      videoPlayer = freshVideo;

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
      // Audio-only: hide video
      videoPlayer.classList.add("hidden");
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

  // =========================================================================
  // SUBTITLE VIDEO STUDIO
  // =========================================================================

  const btnStudioToggle = document.getElementById("btn-studio-toggle");
  const studioPanel = document.getElementById("studio-panel");
  const btnRenderVideo = document.getElementById("btn-render-video");
  const renderProgressEl = document.getElementById("render-progress");
  const renderProgressBar = document.getElementById("render-progress-bar");
  const renderProgressLabel = document.getElementById("render-progress-label");
  const renderElapsedEl = document.getElementById("render-elapsed");
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
  const studioPosY = document.getElementById("studio-pos-y");
  const studioPosYVal = document.getElementById("studio-pos-y-val");
  const studioResolution = document.getElementById("studio-resolution");
  const studioFps = document.getElementById("studio-fps");
  const studioFormat = document.getElementById("studio-format");

  let studioOpen = false;
  let studioGroups = [];
  let studioDuration = 0;
  let studioScrubTime = 0;

  // --- Studio controls binding ---
  if (btnStudioToggle) {
    btnStudioToggle.addEventListener("click", () => {
      studioOpen = !studioOpen;
      studioPanel.classList.toggle("hidden", !studioOpen);
      btnStudioToggle.classList.toggle("active", studioOpen);
      if (studioOpen) {
        buildStudioGroups();
        drawStudioFrame();
      }
    });
  }

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
    [studioPosY, studioPosYVal, "%"],
  ];

  studioRangeInputs.forEach(([input, label, unit]) => {
    if (input) {
      input.addEventListener("input", () => {
        label.textContent = input.value + unit;
        if (input === studioWpg) {
          customGroupsEdited = false;
          buildStudioGroups();
          renderGroupEditor();
        }
        drawStudioFrame();
      });
    }
  });

  // Color/select controls redraw
  [studioFont, studioTextColor, studioActiveColor, studioBgColor, studioStrokeColor, studioResolution].forEach((el) => {
    if (el) el.addEventListener("input", () => drawStudioFrame());
  });

  // Bold toggle redraws
  if (studioBold) studioBold.addEventListener("change", () => drawStudioFrame());

  // Stroke color hex sync
  if (studioStrokeColor && studioStrokeColorHex) {
    studioStrokeColor.addEventListener("input", () => { studioStrokeColorHex.value = studioStrokeColor.value.toUpperCase(); });
    studioStrokeColorHex.addEventListener("input", () => { if (/^#[0-9A-Fa-f]{6}$/.test(studioStrokeColorHex.value)) studioStrokeColor.value = studioStrokeColorHex.value; drawStudioFrame(); });
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
        showToast("Failed to load font: " + e.message);
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
      showToast(`Font "${fontName}" saved`);
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

  /** Gather all current studio control values into a serializable object. */
  function gatherStudioSettings() {
    return {
      font: studioFont.value,
      customFontPath: customFontPath || null,
      fontSize: studioFontSize.value,
      bold: studioBold ? studioBold.checked : true,
      tracking: studioTracking ? studioTracking.value : "0",
      wordSpacing: studioWordSpacing ? studioWordSpacing.value : "0",
      strokeWidth: studioStrokeWidth ? studioStrokeWidth.value : "0",
      strokeColor: studioStrokeColor ? studioStrokeColor.value : "#000000",
      textColor: studioTextColor.value,
      activeColor: studioActiveColor.value,
      bgColor: studioBgColor.value,
      bgOpacity: studioBgOpacity.value,
      padH: studioPadH.value,
      padV: studioPadV.value,
      radius: studioRadius.value,
      wpg: studioWpg.value,
      posY: studioPosY.value,
      resolution: studioResolution.value,
      fps: studioFps.value,
      format: studioFormat.value,
      renderMode: studioRenderMode.value,
      bitrate: studioBitrate.value,
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
    if (p.fontSize) { studioFontSize.value = p.fontSize; studioFontSizeVal.textContent = p.fontSize + "px"; }
    if (studioBold && p.bold !== undefined) studioBold.checked = p.bold;
    if (p.tracking !== undefined && studioTracking) { studioTracking.value = p.tracking; studioTrackingVal.textContent = p.tracking + "px"; }
    if (p.wordSpacing !== undefined && studioWordSpacing) { studioWordSpacing.value = p.wordSpacing; studioWordSpacingVal.textContent = p.wordSpacing + "px"; }
    if (p.strokeWidth !== undefined && studioStrokeWidth) { studioStrokeWidth.value = p.strokeWidth; studioStrokeWidthVal.textContent = p.strokeWidth + "px"; }
    if (p.strokeColor && studioStrokeColor) { studioStrokeColor.value = p.strokeColor; studioStrokeColorHex.value = p.strokeColor.toUpperCase(); }
    if (p.textColor) { studioTextColor.value = p.textColor; studioTextColorHex.value = p.textColor.toUpperCase(); }
    if (p.activeColor) { studioActiveColor.value = p.activeColor; studioActiveColorHex.value = p.activeColor.toUpperCase(); }
    if (p.bgColor) { studioBgColor.value = p.bgColor; studioBgColorHex.value = p.bgColor.toUpperCase(); }
    if (p.bgOpacity) { studioBgOpacity.value = p.bgOpacity; studioBgOpacityVal.textContent = p.bgOpacity + "%"; }
    if (p.padH) { studioPadH.value = p.padH; studioPadHVal.textContent = p.padH + "px"; }
    if (p.padV) { studioPadV.value = p.padV; studioPadVVal.textContent = p.padV + "px"; }
    if (p.radius) { studioRadius.value = p.radius; studioRadiusVal.textContent = p.radius + "px"; }
    if (p.wpg) { studioWpg.value = p.wpg; studioWpgVal.textContent = p.wpg; }
    if (p.posY) { studioPosY.value = p.posY; studioPosYVal.textContent = p.posY + "%"; }
    if (p.resolution) studioResolution.value = p.resolution;
    if (p.fps) studioFps.value = p.fps;
    if (p.format) studioFormat.value = p.format;
    if (p.renderMode) studioRenderMode.value = p.renderMode;
    if (p.bitrate) studioBitrate.value = p.bitrate;
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
          showToast(`Preset "${name}" loaded`);
        }
      } catch (err) {
        showToast("Failed to load preset");
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
        showToast(`Preset "${trimmed}" saved`);
      } catch (err) {
        showToast("Failed to save preset");
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
        chip.className = "ge-word";
        chip.textContent = w.word;
        chip.draggable = true;
        chip.dataset.groupIndex = gi;
        chip.dataset.wordIndex = wi;

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

  // --- Refresh subtitle overlay when studio styles change ---
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

  // --- Subtitle overlay on main video player ---
  function drawSubtitleOverlay(currentTime) {
    if (!subtitleOverlay || !subtitleOverlayCtx || !studioGroups.length) return;
    if (!videoPlayer || videoPlayer.classList.contains("hidden")) return;

    // Match overlay canvas size to the video element's display size
    const rect = videoPlayer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);
    if (subtitleOverlay.width !== cw || subtitleOverlay.height !== ch) {
      subtitleOverlay.width = cw;
      subtitleOverlay.height = ch;
    }
    subtitleOverlay.classList.remove("hidden");

    const ctx = subtitleOverlayCtx;
    ctx.clearRect(0, 0, cw, ch);

    // Find active group
    const t = currentTime;
    let activeGroup = null;
    for (const g of studioGroups) {
      if (g.start <= t && t < g.end) { activeGroup = g; break; }
    }
    if (!activeGroup) return;

    // Read styles from studio controls
    const fontSize = parseInt(studioFontSize.value, 10);
    const fontFamily = studioFont.value;
    const textColor = studioTextColor.value;
    const activeColor = studioActiveColor.value;
    const bgColor = studioBgColor.value;
    const bgOpacity = parseInt(studioBgOpacity.value, 10) / 100;
    const padH = parseInt(studioPadH.value, 10);
    const padV = parseInt(studioPadV.value, 10);
    const radius = parseInt(studioRadius.value, 10);
    const posY = parseInt(studioPosY.value, 10) / 100;
    const isBold = studioBold ? studioBold.checked : true;
    const tracking = parseInt(studioTracking ? studioTracking.value : "0", 10);
    const extraWordSpacing = parseInt(studioWordSpacing ? studioWordSpacing.value : "0", 10);
    const strokeWidth = parseInt(studioStrokeWidth ? studioStrokeWidth.value : "0", 10);
    const strokeColor = studioStrokeColor ? studioStrokeColor.value : "#000000";

    // Scale: map render resolution to displayed overlay size
    const [resW, resH] = studioResolution.value.split("x").map(Number);
    const scaleX = cw / resW;
    const scaleY = ch / resH;
    const scale = Math.min(scaleX, scaleY);

    const sf = fontSize * scale;
    const sp = padH * scale;
    const sv = padV * scale;
    const sr = radius * scale;
    const sTracking = tracking * scale;
    const sWordSpacing = extraWordSpacing * scale;
    const sStroke = strokeWidth * scale;

    const fontWeight = isBold ? "bold" : "normal";
    ctx.font = `${fontWeight} ${sf}px "${fontFamily}", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    // Measure words accounting for tracking (letter spacing)
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
    const wm = activeGroup.words.map((w) => ({
      word: w.word, width: measureWithTracking(w.word), start: w.start, end: w.end,
    }));
    let totalW = 0;
    wm.forEach((m, i) => { totalW += m.width; if (i < wm.length - 1) totalW += effectiveSpaceW; });

    const bgW = totalW + sp * 2;
    const bgH = sf + sv * 2;
    const cx = cw / 2;
    const cy = ch * posY;

    if (bgOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = bgOpacity;
      ctx.fillStyle = bgColor;
      roundRect(ctx, cx - bgW / 2, cy - bgH / 2, bgW, bgH, sr);
      ctx.fill();
      ctx.restore();
    }

    // Draw words with tracking + stroke
    let x = cx - totalW / 2;
    wm.forEach((m, i) => {
      const isActive = m.start <= t && t < m.end;
      const fillColor = isActive ? activeColor : textColor;

      if (sTracking === 0) {
        // Fast path: no tracking
        if (sStroke > 0) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = sStroke * 2;
          ctx.lineJoin = "round";
          ctx.strokeText(m.word, x, cy);
        }
        ctx.fillStyle = fillColor;
        ctx.fillText(m.word, x, cy);
      } else {
        // Character-by-character for tracking
        let cx2 = x;
        for (let ci = 0; ci < m.word.length; ci++) {
          const ch2 = m.word[ci];
          if (sStroke > 0) {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = sStroke * 2;
            ctx.lineJoin = "round";
            ctx.strokeText(ch2, cx2, cy);
          }
          ctx.fillStyle = fillColor;
          ctx.fillText(ch2, cx2, cy);
          cx2 += ctx.measureText(ch2).width + sTracking;
        }
      }
      x += m.width;
      if (i < wm.length - 1) x += effectiveSpaceW;
    });
  }

  // --- Render video ---
  if (btnRenderVideo) {
    btnRenderVideo.addEventListener("click", renderSubtitleVideo);
  }

  async function renderSubtitleVideo() {
    if (!transcriptionResult) {
      showToast("No transcription result. Transcribe a file first.");
      return;
    }

    const renderMode = studioRenderMode ? studioRenderMode.value : "overlay";

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
      font_size: parseInt(studioFontSize.value, 10),
      bold: studioBold ? studioBold.checked : true,
      tracking: parseInt(studioTracking ? studioTracking.value : "0", 10),
      word_spacing: parseInt(studioWordSpacing ? studioWordSpacing.value : "0", 10),
      stroke_width: parseInt(studioStrokeWidth ? studioStrokeWidth.value : "0", 10),
      stroke_color: studioStrokeColor ? studioStrokeColor.value : "#000000",
      text_color: studioTextColor.value,
      active_word_color: studioActiveColor.value,
      bg_color: studioBgColor.value,
      bg_opacity: parseInt(studioBgOpacity.value, 10) / 100,
      bg_padding_h: parseInt(studioPadH.value, 10),
      bg_padding_v: parseInt(studioPadV.value, 10),
      bg_corner_radius: parseInt(studioRadius.value, 10),
      words_per_group: parseInt(studioWpg.value, 10),
      position_y: parseInt(studioPosY.value, 10) / 100,
      resolution_w: resW,
      resolution_h: resH,
      fps: parseInt(studioFps.value, 10),
      output_format: renderMode === "baked" ? "mp4" : studioFormat.value,
      render_mode: renderMode,
      video_bitrate: studioBitrate ? studioBitrate.value : "8M",
    };

    btnRenderVideo.disabled = true;
    btnRenderVideo.textContent = "Rendering…";
    renderProgressEl.classList.remove("hidden");
    renderProgressBar.style.width = "0%";
    renderProgressLabel.textContent = "Starting…";
    if (renderElapsedEl) renderElapsedEl.textContent = "";
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
      showToast("Subtitle video rendered!");
    } catch (err) {
      renderProgressLabel.textContent = `Error: ${err.message}`;
      showToast(`Render failed: ${err.message}`);
    } finally {
      if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
      btnRenderVideo.disabled = false;
      btnRenderVideo.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1ZM1.5 2.75v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25ZM6.5 5a.75.75 0 0 1 .4.114l4 2.667a.75.75 0 0 1 0 1.248l-4 2.667A.75.75 0 0 1 5.75 11V5.75A.75.75 0 0 1 6.5 5Z"/></svg> Render Subtitle Video`;
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
        showToast("Project saved");
      }
    } catch (err) {
      showToast("Failed to save project");
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
      showToast("Project loaded");
    } catch (err) {
      showToast("Failed to open project: " + err.message);
    }
  }

  if (btnProjectSave) btnProjectSave.addEventListener("click", saveProject);
  if (btnProjectOpen) btnProjectOpen.addEventListener("click", openProject);

  // --- Boot ---
  init();
})();
