/**
 * CapForge manual update check.
 *
 * Fetches the latest release metadata from GitHub and, if the remote version
 * is newer than the installed one, invites the user to download the new
 * installer. No auto-update, no background downloads — the user clicks the
 * link, grabs the installer, runs it. Dead simple, nothing to maintain.
 *
 * Expected GitHub release layout:
 *
 *   Tag:      v1.2.0
 *   Assets:   CapForge-Setup-1.2.0.exe  ← the NSIS installer
 *
 * We hit GitHub's public REST API which does not require authentication for
 * anonymous `releases/latest` lookups. If offline, rate-limited, or the repo
 * is unreachable, we fail silently (manual check shows a dialog instead).
 *
 * To point at a different repo, update `GITHUB_REPO` below — that is the
 * single source of truth.
 */

const { app, dialog, shell } = require("electron");
const https = require("https");

const GITHUB_REPO = "FRScz/capforge"; // <-- update to the real repo when published
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch latest release metadata from GitHub. Resolves to `{ version, url, notes }`
 * where `url` is the browser_download_url of the first `.exe` asset (the NSIS
 * installer). Resolves to `null` on any error — the caller decides whether a
 * silent or noisy failure is appropriate.
 */
function fetchLatestRelease() {
  return new Promise((resolve) => {
    const req = https.get(
      RELEASES_API,
      {
        headers: {
          // GitHub requires a User-Agent for anonymous API calls.
          "User-Agent": `CapForge/${app.getVersion()}`,
          "Accept": "application/vnd.github+json",
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            // Strip leading "v" — GitHub tag convention is "v1.2.0",
            // our package.json version is "1.2.0".
            const version = String(data.tag_name || "").replace(/^v/i, "");
            const exeAsset = (data.assets || []).find((a) =>
              typeof a.name === "string" && a.name.toLowerCase().endsWith(".exe")
            );
            resolve({
              version,
              url: exeAsset ? exeAsset.browser_download_url : data.html_url,
              notes: String(data.body || "").trim(),
              htmlUrl: data.html_url,
            });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/**
 * Compare two semver-ish strings ("1.2.10" vs "1.2.2"). Returns >0 if `a > b`,
 * <0 if `a < b`, 0 if equal. Handles missing parts as 0 and ignores any
 * pre-release suffix after a dash.
 */
function compareVersions(a, b) {
  const norm = (v) => String(v).split("-")[0].split(".").map((x) => parseInt(x, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * Check for updates. If `silent` is true (startup check), failures produce no
 * UI and an up-to-date result produces nothing either. If false (manual menu
 * click), both "up to date" and failure states show an informational dialog.
 */
async function checkForUpdates({ parentWindow, silent = false } = {}) {
  const latest = await fetchLatestRelease();
  const current = app.getVersion();

  if (!latest || !latest.version) {
    if (!silent) {
      dialog.showMessageBox(parentWindow, {
        type: "info",
        title: "CapForge — Update Check",
        message: "Couldn't reach the update server.",
        detail: "Check your internet connection and try again.",
        buttons: ["OK"],
      });
    }
    return;
  }

  if (compareVersions(latest.version, current) <= 0) {
    if (!silent) {
      dialog.showMessageBox(parentWindow, {
        type: "info",
        title: "CapForge — Up to Date",
        message: `You're running the latest version (${current}).`,
        buttons: ["OK"],
      });
    }
    return;
  }

  // New version available — always shown (startup or manual).
  const result = await dialog.showMessageBox(parentWindow, {
    type: "info",
    title: "CapForge — Update Available",
    message: `CapForge ${latest.version} is available.`,
    detail:
      `You're currently running ${current}.\n\n` +
      (latest.notes ? `Release notes:\n${latest.notes.slice(0, 500)}` : "") +
      "\n\nDownloading will open your browser — run the new installer to update.",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) {
    shell.openExternal(latest.url || latest.htmlUrl);
  }
}

module.exports = { checkForUpdates, compareVersions, GITHUB_REPO };
