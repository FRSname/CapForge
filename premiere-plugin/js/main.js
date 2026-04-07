/**
 * SubForge Premiere Pro Panel — main.js
 *
 * Reads .subforge / .srt files, communicates with ExtendScript to place
 * MOGRT clips on the Premiere Pro timeline.
 */

(function () {
    "use strict";

    var cs = new CSInterface();
    var fs = require("fs");
    var path = require("path");

    // --- DOM refs ---
    var btnLoadSubforge = document.getElementById("btn-load-subforge");
    var subforgePath = document.getElementById("subforge-path");
    var subtitlePreview = document.getElementById("subtitle-preview");
    var subtitleCount = document.getElementById("subtitle-count");

    var btnLoadMogrt = document.getElementById("btn-load-mogrt");
    var mogrtPathEl = document.getElementById("mogrt-path");
    var mogrtProps = document.getElementById("mogrt-props");
    var selTextProp = document.getElementById("sel-text-prop");

    var selDisplayMode = document.getElementById("sel-display-mode");
    var selTrack = document.getElementById("sel-track");
    var inpOffset = document.getElementById("inp-offset");

    var btnCreate = document.getElementById("btn-create");
    var btnClearTrack = document.getElementById("btn-clear-track");
    var btnRefresh = document.getElementById("btn-refresh");

    var progressSection = document.getElementById("progress-section");
    var progressBar = document.getElementById("progress-bar");
    var progressLabel = document.getElementById("progress-label");

    var statusDot = document.getElementById("status-dot");
    var statusText = document.getElementById("status-text");

    var toastEl = document.getElementById("toast");

    // --- State ---
    var subforgeData = null;    // Parsed subtitle data
    var subforgeFilePath = "";  // Path to loaded file
    var mogrtFilePath = "";     // Path to selected MOGRT
    var sequenceInfo = null;    // Current sequence info

    // --- Init ---
    function init() {
        refreshSequenceInfo();
        bindEvents();
    }

    function bindEvents() {
        btnLoadSubforge.addEventListener("click", loadSubforgeFile);
        btnLoadMogrt.addEventListener("click", loadMogrtFile);
        btnCreate.addEventListener("click", createSubtitles);
        btnClearTrack.addEventListener("click", clearSelectedTrack);
        btnRefresh.addEventListener("click", refreshSequenceInfo);
    }

    // --- Sequence Info ---
    function refreshSequenceInfo() {
        evalJSX("getSequenceInfo()", function (result) {
            try {
                sequenceInfo = JSON.parse(result);
                if (sequenceInfo.error) {
                    setStatus("error", sequenceInfo.error);
                    sequenceInfo = null;
                } else {
                    setStatus("ready", sequenceInfo.name + " — " +
                        sequenceInfo.width + "×" + sequenceInfo.height + " @ " +
                        Math.round(1 / sequenceInfo.frameRate) + "fps");
                    btnClearTrack.disabled = false;
                }
            } catch (e) {
                setStatus("error", "No active sequence. Open a sequence first.");
                sequenceInfo = null;
            }
            updateCreateButton();
        });
    }

    // --- Load SubForge / SRT ---
    function loadSubforgeFile() {
        evalJSX("selectSubForgeFile()", function (filePath) {
            if (!filePath) return;

            subforgeFilePath = filePath;
            subforgePath.textContent = path.basename(filePath);
            subforgePath.classList.add("has-file");

            try {
                var content = fs.readFileSync(filePath, "utf-8");
                var ext = path.extname(filePath).toLowerCase();

                if (ext === ".subforge" || ext === ".json") {
                    subforgeData = parseSubForge(content);
                } else if (ext === ".srt") {
                    subforgeData = parseSRT(content);
                } else {
                    toast("Unsupported file format: " + ext);
                    return;
                }

                renderPreview();
                updateCreateButton();
                toast("Loaded " + subforgeData.subtitles.length + " subtitles");
            } catch (e) {
                toast("Error reading file: " + e.message);
                subforgeData = null;
            }
        });
    }

    // --- SubForge Parser ---
    function parseSubForge(content) {
        var doc = JSON.parse(content);
        var subtitles = [];

        if (!doc.segments) {
            return { subtitles: [] };
        }

        doc.segments.forEach(function (seg) {
            // Store all levels: segment, groups, words
            subtitles.push({
                type: "segment",
                start: seg.start,
                end: seg.end,
                text: seg.text,
                speaker: seg.speaker || null,
                words: (seg.words || []).map(function (w) {
                    return { word: w.word, start: w.start, end: w.end };
                }),
                groups: (seg.groups || []).map(function (g) {
                    return { text: g.text, start: g.start, end: g.end };
                })
            });
        });

        return {
            subtitles: subtitles,
            metadata: doc.metadata || {},
            raw: doc
        };
    }

    // --- SRT Parser ---
    function parseSRT(content) {
        var blocks = content.trim().split(/\n\s*\n/);
        var subtitles = [];

        blocks.forEach(function (block) {
            var lines = block.trim().split("\n");
            if (lines.length < 3) return;

            var timeLine = lines[1];
            var match = timeLine.match(
                /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
            );
            if (!match) return;

            var start = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 +
                        parseInt(match[3]) + parseInt(match[4]) / 1000;
            var end = parseInt(match[5]) * 3600 + parseInt(match[6]) * 60 +
                      parseInt(match[7]) + parseInt(match[8]) / 1000;

            var text = lines.slice(2).join(" ").replace(/<[^>]+>/g, "").trim();

            subtitles.push({
                type: "segment",
                start: start,
                end: end,
                text: text,
                words: [],
                groups: []
            });
        });

        return { subtitles: subtitles, metadata: {} };
    }

    // --- Preview ---
    function renderPreview() {
        if (!subforgeData || !subforgeData.subtitles.length) {
            subtitlePreview.classList.add("hidden");
            subtitleCount.classList.add("hidden");
            return;
        }

        subtitlePreview.innerHTML = "";
        var displaySubs = getDisplaySubtitles();
        var maxPreview = Math.min(displaySubs.length, 50);

        for (var i = 0; i < maxPreview; i++) {
            var sub = displaySubs[i];
            var div = document.createElement("div");
            div.className = "preview-item";

            var time = document.createElement("span");
            time.className = "preview-time";
            time.textContent = formatTime(sub.start);

            var text = document.createElement("span");
            text.className = "preview-text";
            text.textContent = sub.text;

            div.appendChild(time);
            div.appendChild(text);
            subtitlePreview.appendChild(div);
        }

        subtitlePreview.classList.remove("hidden");
        subtitleCount.textContent = displaySubs.length + " subtitle clips will be created" +
            (displaySubs.length > 50 ? " (showing first 50)" : "");
        subtitleCount.classList.remove("hidden");
    }

    /**
     * Get the subtitle array based on selected display mode.
     * Modes: "segments" (full phrases), "groups" (word groups), "words" (individual).
     */
    function getDisplaySubtitles() {
        if (!subforgeData) return [];

        var mode = selDisplayMode.value;
        var result = [];

        subforgeData.subtitles.forEach(function (seg) {
            if (mode === "segments") {
                result.push({ start: seg.start, end: seg.end, text: seg.text });
            } else if (mode === "groups" && seg.groups && seg.groups.length > 0) {
                seg.groups.forEach(function (g) {
                    result.push({ start: g.start, end: g.end, text: g.text });
                });
            } else if (mode === "words" && seg.words && seg.words.length > 0) {
                seg.words.forEach(function (w) {
                    result.push({ start: w.start, end: w.end, text: w.word });
                });
            } else {
                // Fallback to segment
                result.push({ start: seg.start, end: seg.end, text: seg.text });
            }
        });

        return result;
    }

    // --- Load MOGRT ---
    function loadMogrtFile() {
        evalJSX("selectMOGRTFile()", function (filePath) {
            if (!filePath) return;

            mogrtFilePath = filePath;
            mogrtPathEl.textContent = path.basename(filePath);
            mogrtPathEl.classList.add("has-file");

            // To discover MOGRT properties, we need to place a temp clip,
            // read its properties, then remove it.
            discoverMogrtProperties();
            updateCreateButton();
        });
    }

    /**
     * Place a temporary MOGRT clip to discover its Essential Graphics properties,
     * then remove it.
     */
    function discoverMogrtProperties() {
        if (!sequenceInfo || !mogrtFilePath) return;

        var tps = sequenceInfo.timebase;
        var startTicks = "0";
        var endTicks = String(Math.round(2 * tps)); // 2-second temp clip

        evalJSX(
            'importAndPlaceMOGRT("' + escapeJSX(mogrtFilePath) + '", 0, "' + startTicks + '", "' + endTicks + '")',
            function (result) {
                try {
                    var r = JSON.parse(result);
                    if (r.error) {
                        toast("MOGRT error: " + r.error);
                        return;
                    }

                    // Now read its properties
                    evalJSX('getMGTComponentProperties(0, ' + r.clipIndex + ')', function (propResult) {
                        try {
                            var pr = JSON.parse(propResult);

                            // Remove the temp clip
                            evalJSX('clearTrack(0)', function () {
                                refreshSequenceInfo();
                            });

                            if (pr.error) {
                                toast("Could not read MOGRT properties: " + pr.error);
                                return;
                            }

                            // Populate text property dropdown
                            selTextProp.innerHTML = "";
                            pr.properties.forEach(function (p) {
                                var opt = document.createElement("option");
                                opt.value = p.index;
                                opt.textContent = p.displayName + (typeof p.value === "string" ? ' = "' + p.value.substring(0, 20) + '"' : "");
                                selTextProp.appendChild(opt);
                            });

                            // Auto-select the first text-looking property
                            for (var i = 0; i < pr.properties.length; i++) {
                                var name = pr.properties[i].displayName.toLowerCase();
                                if (name.indexOf("text") !== -1 || name.indexOf("source") !== -1 || name.indexOf("subtitle") !== -1) {
                                    selTextProp.value = pr.properties[i].index;
                                    break;
                                }
                            }

                            mogrtProps.classList.remove("hidden");
                            toast("MOGRT loaded — " + pr.properties.length + " properties found");
                        } catch (e) {
                            toast("Error reading properties: " + e.message);
                        }
                    });
                } catch (e) {
                    toast("Error placing temp MOGRT: " + e.message);
                }
            }
        );
    }

    // --- Create Subtitles ---
    function createSubtitles() {
        if (!subforgeData || !mogrtFilePath || !sequenceInfo) return;

        var displaySubs = getDisplaySubtitles();
        if (displaySubs.length === 0) {
            toast("No subtitles to create");
            return;
        }

        var offset = parseFloat(inpOffset.value) || 0;
        var trackIdx = parseInt(selTrack.value, 10);
        var textPropIdx = selTextProp.value !== "" ? parseInt(selTextProp.value, 10) : null;

        // Apply time offset
        var subs = displaySubs.map(function (s) {
            return {
                text: s.text,
                start: s.start + offset,
                end: s.end + offset
            };
        });

        var payload = {
            mogrtPath: mogrtFilePath,
            targetTrack: trackIdx,
            subtitles: subs,
            textPropIndex: textPropIdx
        };

        // Show progress
        progressSection.classList.remove("hidden");
        progressBar.style.width = "0%";
        progressLabel.textContent = "Placing subtitles…";
        btnCreate.disabled = true;
        setStatus("working", "Creating " + subs.length + " subtitle clips…");

        // Send to ExtendScript
        var jsonStr = JSON.stringify(payload);
        evalJSX('createSubtitles(\'' + escapeJSXString(jsonStr) + '\')', function (result) {
            try {
                var r = JSON.parse(result);
                progressBar.style.width = "100%";

                if (r.error) {
                    progressLabel.textContent = "Error: " + r.error;
                    setStatus("error", r.error);
                } else {
                    progressLabel.textContent = "Done! Placed " + r.placed + " / " + r.total + " clips";
                    setStatus("ready", "Placed " + r.placed + " subtitle clips on V" + (trackIdx + 1));
                    toast("✅ " + r.placed + " subtitles created!");

                    if (r.errors && r.errors.length > 0) {
                        console.warn("SubForge errors:", r.errors);
                    }
                }
            } catch (e) {
                progressLabel.textContent = "Error: " + e.message;
                setStatus("error", e.message);
            }

            btnCreate.disabled = false;
            refreshSequenceInfo();
        });
    }

    // --- Clear Track ---
    function clearSelectedTrack() {
        var trackIdx = parseInt(selTrack.value, 10);
        if (!confirm("Clear all clips from V" + (trackIdx + 1) + "?")) return;

        evalJSX('clearTrack(' + trackIdx + ')', function (result) {
            try {
                var r = JSON.parse(result);
                if (r.error) {
                    toast("Error: " + r.error);
                } else {
                    toast("Removed " + r.removed + " clips from V" + (trackIdx + 1));
                    refreshSequenceInfo();
                }
            } catch (e) {
                toast("Error: " + e.message);
            }
        });
    }

    // --- Update display mode preview ---
    selDisplayMode.addEventListener("change", function () {
        renderPreview();
    });

    // --- Helpers ---
    function updateCreateButton() {
        btnCreate.disabled = !(subforgeData && mogrtFilePath && sequenceInfo);
    }

    function setStatus(state, text) {
        statusDot.className = "status-dot " + state;
        statusText.textContent = text;
    }

    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add("show");
        setTimeout(function () {
            toastEl.classList.remove("show");
        }, 3000);
    }

    function formatTime(seconds) {
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        var ms = Math.floor((seconds % 1) * 100);
        return pad(m) + ":" + pad(s) + "." + pad(ms);
    }

    function pad(n) {
        return n < 10 ? "0" + n : String(n);
    }

    /** Evaluate ExtendScript via CSInterface */
    function evalJSX(script, callback) {
        cs.evalScript("$._ext_SubForge = $._ext_SubForge || {}; " + script, callback);
    }

    /** Escape a file path for embedding in JSX string */
    function escapeJSX(str) {
        return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    /** Escape a full JSON string for embedding in JSX single-quoted string */
    function escapeJSXString(str) {
        return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "");
    }

    // --- Start ---
    init();
})();
