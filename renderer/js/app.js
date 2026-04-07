/**
 * SubForge — Main application logic.
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

  // --- State ---
  let selectedFilePath = null;
  let outputDir = "output";
  let transcriptionResult = null;
  let wavesurfer = null;
  let currentScreen = "file";
  let editMode = false;
  let hasEdits = false;
  let loopSegment = null; // { start, end } for loop-play in edit mode

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
    // Ignore if typing in an input or contenteditable
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
    } else if (e.key === "s" && e.ctrlKey && currentScreen === "results" && editMode) {
      e.preventDefault();
      saveEdits();
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
  function onProgressUpdate(update) {
    // Forward render progress to studio
    if (update.status === "rendering" || update.status === "encoding") {
      onRenderProgress(update);
      return;
    }

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

      // Update individual word texts if the user edited word by word
      // Since contenteditable flattens word spans, rebuild words from plain text
      const words = newText.split(/\s+/).filter(Boolean);
      if (seg.words && seg.words.length > 0) {
        // Map new words to old word timings (best effort)
        const newWords = [];
        for (let i = 0; i < words.length; i++) {
          if (i < seg.words.length) {
            newWords.push({ ...seg.words[i], word: words[i] });
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
      // Sync studio preview if open
      if (studioOpen && studioDuration > 0) {
        studioScrubTime = currentTime;
        const pct = (currentTime / studioDuration) * 100;
        if (studioScrubber) studioScrubber.value = Math.min(pct, 100);
        if (studioTimeLabel) studioTimeLabel.textContent = `${formatTime(currentTime)} / ${formatTime(studioDuration)}`;
        drawStudioFrame();
      }
      // Draw subtitle overlay on main video
      drawSubtitleOverlay(currentTime);
    });

    wavesurfer.on("play", () => {
      if (studioOpen) {
        studioPlaying = true;
        if (studioIconPlay) studioIconPlay.classList.add("hidden");
        if (studioIconPause) studioIconPause.classList.remove("hidden");
      }
    });

    wavesurfer.on("pause", () => {
      if (studioOpen) {
        studioPlaying = false;
        if (studioIconPlay) studioIconPlay.classList.remove("hidden");
        if (studioIconPause) studioIconPause.classList.add("hidden");
      }
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
  const studioCanvas = document.getElementById("studio-canvas");
  const studioCtx = studioCanvas ? studioCanvas.getContext("2d") : null;
  const studioScrubber = document.getElementById("studio-scrubber");
  const studioTimeLabel = document.getElementById("studio-time");
  const btnRenderVideo = document.getElementById("btn-render-video");
  const renderProgressEl = document.getElementById("render-progress");
  const renderProgressBar = document.getElementById("render-progress-bar");
  const renderProgressLabel = document.getElementById("render-progress-label");

  // Studio style controls
  const studioFont = document.getElementById("studio-font");
  const studioFontSize = document.getElementById("studio-font-size");
  const studioFontSizeVal = document.getElementById("studio-font-size-val");
  const studioTextColor = document.getElementById("studio-text-color");
  const studioActiveColor = document.getElementById("studio-active-color");
  const studioBgColor = document.getElementById("studio-bg-color");
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
  let studioPlaying = false;
  let studioAnimFrame = null;
  const studioPlayBtn = document.getElementById("studio-play-btn");
  const studioIconPlay = document.getElementById("studio-icon-play");
  const studioIconPause = document.getElementById("studio-icon-pause");

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
        if (input === studioWpg) buildStudioGroups();
        drawStudioFrame();
      });
    }
  });

  // Color/select controls redraw
  [studioFont, studioTextColor, studioActiveColor, studioBgColor, studioResolution].forEach((el) => {
    if (el) el.addEventListener("input", () => drawStudioFrame());
  });

  // Scrubber — also seek video/audio
  if (studioScrubber) {
    studioScrubber.addEventListener("input", () => {
      studioScrubTime = (parseFloat(studioScrubber.value) / 100) * studioDuration;
      studioTimeLabel.textContent = `${formatTime(studioScrubTime)} / ${formatTime(studioDuration)}`;
      // Seek the underlying media to match
      if (wavesurfer && wavesurfer.getDuration() > 0) {
        wavesurfer.seekTo(studioScrubTime / wavesurfer.getDuration());
      }
      drawStudioFrame();
    });
  }

  // Play/Pause button in studio
  if (studioPlayBtn) {
    studioPlayBtn.addEventListener("click", () => {
      if (!wavesurfer) return;
      wavesurfer.playPause();
    });
  }

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

    // Update scrubber range
    if (studioScrubber) studioScrubber.max = "100";
    if (studioTimeLabel) studioTimeLabel.textContent = `${formatTime(studioScrubTime)} / ${formatTime(studioDuration)}`;
  }

  // --- Canvas drawing ---
  function drawStudioFrame() {
    if (!studioCtx || !studioCanvas) return;

    const canvasW = studioCanvas.width;
    const canvasH = studioCanvas.height;

    // Draw video frame as background if available, otherwise checkerboard
    if (videoPlayer && videoPlayer.readyState >= 2 && !videoPlayer.classList.contains("hidden")) {
      studioCtx.drawImage(videoPlayer, 0, 0, canvasW, canvasH);
    } else {
      drawCheckerboard(canvasW, canvasH);
    }

    if (studioGroups.length === 0) {
      studioCtx.fillStyle = "#aaa";
      studioCtx.font = "16px Arial";
      studioCtx.textAlign = "center";
      studioCtx.fillText("No subtitle data — transcribe a file first", canvasW / 2, canvasH / 2);
      return;
    }

    // Find active group at current scrub time
    const t = studioScrubTime;
    let activeGroup = null;
    for (const g of studioGroups) {
      if (g.start <= t && t < g.end) {
        activeGroup = g;
        break;
      }
    }

    if (!activeGroup) {
      // Show first group as preview when no active
      if (studioGroups.length > 0 && t < studioGroups[0].start) {
        activeGroup = studioGroups[0];
      } else {
        return; // Between groups — show nothing
      }
    }

    // Read style
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

    // Scale factor: canvas is 960x540, render is 1920x1080 default
    const [resW, resH] = studioResolution.value.split("x").map(Number);
    const scaleX = canvasW / resW;
    const scaleY = canvasH / resH;
    const scale = Math.min(scaleX, scaleY);

    const scaledFontSize = fontSize * scale;
    const scaledPadH = padH * scale;
    const scaledPadV = padV * scale;
    const scaledRadius = radius * scale;

    const ctx = studioCtx;
    ctx.font = `bold ${scaledFontSize}px "${fontFamily}", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    // Measure words
    const spaceW = ctx.measureText(" ").width;
    const wordMetrics = activeGroup.words.map((w) => ({
      word: w.word,
      width: ctx.measureText(w.word).width,
      start: w.start,
      end: w.end,
    }));

    let totalW = 0;
    wordMetrics.forEach((wm, i) => {
      totalW += wm.width;
      if (i < wordMetrics.length - 1) totalW += spaceW;
    });

    // Background
    const bgW = totalW + scaledPadH * 2;
    const bgH = scaledFontSize + scaledPadV * 2;
    const centerX = canvasW / 2;
    const centerY = canvasH * posY;

    if (bgOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = bgOpacity;
      ctx.fillStyle = bgColor;
      roundRect(ctx, centerX - bgW / 2, centerY - bgH / 2, bgW, bgH, scaledRadius);
      ctx.fill();
      ctx.restore();
    }

    // Draw words
    let x = centerX - totalW / 2;
    const y = centerY;

    wordMetrics.forEach((wm, i) => {
      const isActive = wm.start <= t && t < wm.end;
      ctx.fillStyle = isActive ? activeColor : textColor;
      ctx.fillText(wm.word, x, y);
      x += wm.width;
      if (i < wordMetrics.length - 1) x += spaceW;
    });
  }

  function drawCheckerboard(w, h) {
    const ctx = studioCtx;
    const size = 10;
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? "#1a1a1a" : "#222";
        ctx.fillRect(x, y, size, size);
      }
    }
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

    // Scale: map render resolution to displayed overlay size
    const [resW, resH] = studioResolution.value.split("x").map(Number);
    const scaleX = cw / resW;
    const scaleY = ch / resH;
    const scale = Math.min(scaleX, scaleY);

    const sf = fontSize * scale;
    const sp = padH * scale;
    const sv = padV * scale;
    const sr = radius * scale;

    ctx.font = `bold ${sf}px "${fontFamily}", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const spaceW = ctx.measureText(" ").width;
    const wm = activeGroup.words.map((w) => ({
      word: w.word, width: ctx.measureText(w.word).width, start: w.start, end: w.end,
    }));
    let totalW = 0;
    wm.forEach((m, i) => { totalW += m.width; if (i < wm.length - 1) totalW += spaceW; });

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

    let x = cx - totalW / 2;
    wm.forEach((m, i) => {
      ctx.fillStyle = (m.start <= t && t < m.end) ? activeColor : textColor;
      ctx.fillText(m.word, x, cy);
      x += m.width;
      if (i < wm.length - 1) x += spaceW;
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

    const [resW, resH] = studioResolution.value.split("x").map(Number);

    const config = {
      font_family: studioFont.value,
      font_size: parseInt(studioFontSize.value, 10),
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
      output_format: studioFormat.value,
    };

    btnRenderVideo.disabled = true;
    btnRenderVideo.textContent = "Rendering…";
    renderProgressEl.classList.remove("hidden");
    renderProgressBar.style.width = "0%";
    renderProgressLabel.textContent = "Starting…";

    try {
      const res = await api.renderVideo({
        config: config,
        output_dir: outputDir,
      });
      renderProgressBar.style.width = "100%";
      renderProgressLabel.textContent = `Done! ${res.file}`;
      showToast("Subtitle video rendered!");
    } catch (err) {
      renderProgressLabel.textContent = `Error: ${err.message}`;
      showToast(`Render failed: ${err.message}`);
    } finally {
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

  // --- Boot ---
  init();
})();
