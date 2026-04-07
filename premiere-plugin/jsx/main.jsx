/**
 * SubForge — Premiere Pro ExtendScript
 *
 * Handles MOGRT import, timeline placement, and property setting.
 * Called from the CEP panel JS via csInterface.evalScript().
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ticksToSeconds(ticks, ticksPerSecond) {
    return parseInt(ticks, 10) / ticksPerSecond;
}

function secondsToTicks(secs, ticksPerSecond) {
    return String(Math.round(secs * ticksPerSecond));
}

function getTicksPerSecond() {
    return parseInt(app.project.activeSequence.timebase, 10);
}

// Get active sequence or return error
function getActiveSequence() {
    var seq = app.project.activeSequence;
    if (!seq) {
        return null;
    }
    return seq;
}

// ---------------------------------------------------------------------------
// Sequence Info
// ---------------------------------------------------------------------------

function getSequenceInfo() {
    var seq = getActiveSequence();
    if (!seq) {
        return JSON.stringify({ error: "No active sequence" });
    }
    var tps = getTicksPerSecond();
    return JSON.stringify({
        name: seq.name,
        frameRate: seq.getSettings().videoFrameRate.seconds,
        width: seq.frameSizeHorizontal,
        height: seq.frameSizeVertical,
        duration: ticksToSeconds(seq.end, tps),
        videoTrackCount: seq.videoTracks.numTracks,
        audioTrackCount: seq.audioTracks.numTracks,
        timebase: tps
    });
}

// ---------------------------------------------------------------------------
// MOGRT Import & Placement
// ---------------------------------------------------------------------------

/**
 * Import a MOGRT file and place it on the timeline.
 *
 * @param {string} mogrtPath  - Full path to the .mogrt file
 * @param {number} targetTrackIdx - 0-based video track index
 * @param {string} startTicks - Start time in ticks
 * @param {string} endTicks   - End time in ticks
 * @returns {string} JSON with clip info or error
 */
function importAndPlaceMOGRT(mogrtPath, targetTrackIdx, startTicks, endTicks) {
    var seq = getActiveSequence();
    if (!seq) {
        return JSON.stringify({ error: "No active sequence" });
    }

    var track = seq.videoTracks[targetTrackIdx];
    if (!track) {
        return JSON.stringify({ error: "Video track V" + (targetTrackIdx + 1) + " not found. Create more tracks in the sequence." });
    }

    // Use importMGT to insert the MOGRT onto the track
    var success = seq.importMGT(
        mogrtPath,
        startTicks,      // time in ticks
        targetTrackIdx,  // video track index (0-based)
        0                // audio track index
    );

    if (!success) {
        return JSON.stringify({ error: "Failed to import MOGRT. Check file path: " + mogrtPath });
    }

    // Find the clip we just placed (last clip on the track)
    var clipCount = track.clips.numItems;
    if (clipCount > 0) {
        var lastClip = track.clips[clipCount - 1];
        // Trim the clip to desired end time using Time object
        var newEnd = new Time();
        newEnd.ticks = endTicks;
        lastClip.end = newEnd;

        return JSON.stringify({
            status: "ok",
            clipIndex: clipCount - 1,
            name: lastClip.name,
            start: lastClip.start.ticks,
            end: lastClip.end.ticks
        });
    }

    return JSON.stringify({ error: "MOGRT placed but clip not found on track" });
}

// ---------------------------------------------------------------------------
// MOGRT Component Property Access
// ---------------------------------------------------------------------------

/**
 * Get the Motion Graphics Template component properties of a clip.
 */
function getMGTComponentProperties(trackIdx, clipIdx) {
    var seq = getActiveSequence();
    if (!seq) return JSON.stringify({ error: "No active sequence" });

    var track = seq.videoTracks[trackIdx];
    if (!track) return JSON.stringify({ error: "Track not found: " + trackIdx });

    var clip = track.clips[clipIdx];
    if (!clip) return JSON.stringify({ error: "Clip not found: " + clipIdx });

    var comp = clip.getMGTComponent();
    if (!comp) {
        // Try projectItem components
        return JSON.stringify({ error: "No MGT component found on clip" });
    }

    var props = [];
    for (var i = 0; i < comp.properties.numItems; i++) {
        var prop = comp.properties[i];
        var propInfo = {
            index: i,
            displayName: prop.displayName,
            matchName: ""
        };

        try {
            propInfo.value = prop.getValue();
        } catch (e) {
            propInfo.value = "[unreadable]";
        }

        props.push(propInfo);
    }

    return JSON.stringify({ properties: props });
}

/**
 * Set a text property on a MOGRT clip's MGT component.
 *
 * @param {number} trackIdx  - 0-based video track index
 * @param {number} clipIdx   - 0-based clip index on that track
 * @param {number} propIdx   - Property index on the MGT component
 * @param {string} value     - New value to set
 */
function setMGTProperty(trackIdx, clipIdx, propIdx, value) {
    var seq = getActiveSequence();
    if (!seq) return JSON.stringify({ error: "No active sequence" });

    var track = seq.videoTracks[trackIdx];
    if (!track) return JSON.stringify({ error: "Track not found" });

    var clip = track.clips[clipIdx];
    if (!clip) return JSON.stringify({ error: "Clip not found" });

    var comp = clip.getMGTComponent();
    if (!comp) return JSON.stringify({ error: "No MGT component" });

    var prop = comp.properties[propIdx];
    if (!prop) return JSON.stringify({ error: "Property not found at index " + propIdx });

    try {
        prop.setValue(value, true);
        return JSON.stringify({ status: "ok", property: prop.displayName, value: value });
    } catch (e) {
        return JSON.stringify({ error: "Failed to set property: " + e.toString() });
    }
}

// ---------------------------------------------------------------------------
// Batch Create Subtitles
// ---------------------------------------------------------------------------

/**
 * Main entry point: Create all subtitle clips from SubForge data.
 *
 * @param {string} jsonStr - JSON string with:
 *   - mogrtPath: path to .mogrt file
 *   - targetTrack: video track index (0-based)
 *   - subtitles: array of { text, start, end, words }
 *   - textPropIndex: property index for the text field in the MOGRT
 * @returns {string} JSON result summary
 */
function createSubtitles(jsonStr) {
    var data = JSON.parse(jsonStr);
    var mogrtPath = data.mogrtPath;
    var targetTrack = data.targetTrack || 1; // Default to track V2
    var subtitles = data.subtitles;
    var textPropIndex = data.textPropIndex;

    var seq = getActiveSequence();
    if (!seq) return JSON.stringify({ error: "No active sequence" });

    var tps = getTicksPerSecond();

    // Verify target track exists
    if (targetTrack >= seq.videoTracks.numTracks) {
        return JSON.stringify({ error: "Video track V" + (targetTrack + 1) + " does not exist. Add more tracks to the sequence." });
    }

    var placed = 0;
    var errors = [];

    for (var i = 0; i < subtitles.length; i++) {
        var sub = subtitles[i];
        var startTicks = secondsToTicks(sub.start, tps);
        var endTicks = secondsToTicks(sub.end, tps);

        // Import MOGRT at position
        var success = seq.importMGT(
            mogrtPath,
            startTicks,
            targetTrack,
            0
        );

        if (!success) {
            errors.push("Failed to place subtitle #" + i + ": " + sub.text);
            continue;
        }

        // Get the clip we just placed (last on track)
        var track = seq.videoTracks[targetTrack];
        var clipIdx = track.clips.numItems - 1;
        var clip = track.clips[clipIdx];

        // Trim end using Time object
        var newEnd = new Time();
        newEnd.ticks = endTicks;
        clip.end = newEnd;

        // Set the text property
        if (textPropIndex !== undefined && textPropIndex !== null) {
            var comp = clip.getMGTComponent();
            if (comp && comp.properties[textPropIndex]) {
                try {
                    comp.properties[textPropIndex].setValue(sub.text, true);
                } catch (e) {
                    errors.push("Text set failed for #" + i + ": " + e.toString());
                }
            }
        }

        placed++;

        // Update progress via callback (every 10 clips)
        if (i % 10 === 0) {
            app.setSDKEventMessage("SubForge: Placed " + (i + 1) + " / " + subtitles.length, "info");
        }
    }

    app.setSDKEventMessage("SubForge: Done! Placed " + placed + " subtitles.", "info");

    return JSON.stringify({
        status: "ok",
        placed: placed,
        total: subtitles.length,
        errors: errors
    });
}

// ---------------------------------------------------------------------------
// Video Track Utilities
// ---------------------------------------------------------------------------

function getVideoTracks() {
    var seq = getActiveSequence();
    if (!seq) return JSON.stringify({ error: "No active sequence" });

    var tracks = [];
    for (var i = 0; i < seq.videoTracks.numTracks; i++) {
        var t = seq.videoTracks[i];
        tracks.push({
            index: i,
            name: t.name || ("V" + (i + 1)),
            clipCount: t.clips.numItems
        });
    }
    return JSON.stringify({ tracks: tracks });
}

/**
 * Clear all clips from a specific video track.
 */
function clearTrack(trackIdx) {
    var seq = getActiveSequence();
    if (!seq) return JSON.stringify({ error: "No active sequence" });

    var track = seq.videoTracks[trackIdx];
    if (!track) return JSON.stringify({ error: "Track not found" });

    // Remove clips in reverse order
    var removed = 0;
    for (var i = track.clips.numItems - 1; i >= 0; i--) {
        track.clips[i].remove(false, false);
        removed++;
    }

    return JSON.stringify({ status: "ok", removed: removed });
}

// ---------------------------------------------------------------------------
// File Dialog
// ---------------------------------------------------------------------------

function openFileDialog(title, filter) {
    var f = File.openDialog(title, filter);
    if (f) {
        return f.fsName;
    }
    return "";
}

function selectSubForgeFile() {
    return openFileDialog("Select SubForge file", "SubForge files:*.subforge,SRT files:*.srt,All files:*.*");
}

function selectMOGRTFile() {
    return openFileDialog("Select MOGRT template", "MOGRT files:*.mogrt");
}
