/**
 * CapForge — Electron main process.
 * Spawns the Python FastAPI backend and opens the renderer window.
 */

const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { PythonBackend } = require("./python-manager");
const { ensureRuntime, isRuntimeReady, detectAccelerator } = require("./runtime-setup");
const appState = require("./app-state");
const { checkForUpdates } = require("./update-check");

let mainWindow = null;
let setupWindow = null;
let pythonBackend = null;

function createWindow() {
  // Restore last window position/size if we have one.
  const saved = appState.get("window", {});
  const opts = {
    width: saved.width || 1500,
    height: saved.height || 1400,
    minWidth: 760,
    minHeight: 560,
    title: "CapForge",
    icon: path.join(__dirname, "..", "renderer", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#0d1117",
    show: false,
  };
  // Only restore coordinates if they're on a currently-connected display,
  // otherwise the window can end up invisible on a detached second monitor.
  if (typeof saved.x === "number" && typeof saved.y === "number") {
    const { screen } = require("electron");
    const bounds = { x: saved.x, y: saved.y, width: opts.width, height: opts.height };
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const a = d.workArea;
      return bounds.x < a.x + a.width && bounds.x + bounds.width > a.x
          && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y;
    });
    if (visible) {
      opts.x = saved.x;
      opts.y = saved.y;
    }
  }

  mainWindow = new BrowserWindow(opts);

  if (saved.maximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  Menu.setApplicationMenu(buildAppMenu());

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Open DevTools in dev mode
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  // Persist window bounds whenever they change. Debounce via a timer so
  // we don't thrash the disk during an interactive drag.
  let saveTimer = null;
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const maximized = mainWindow.isMaximized();
      // Don't store the maximized geometry as the normal bounds — we want
      // to restore the un-maximized size if the user un-maximizes later.
      const b = maximized ? (mainWindow.getNormalBounds?.() || mainWindow.getBounds()) : mainWindow.getBounds();
      appState.set("window", { x: b.x, y: b.y, width: b.width, height: b.height, maximized });
    }, 300);
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);
  mainWindow.on("maximize", saveBounds);
  mainWindow.on("unmaximize", saveBounds);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * Open the folder that contains the backend log file in the OS file manager.
 * Called from the app menu and from the renderer via IPC.
 */
function openLogsFolder() {
  const logDir = app.getPath("logs");
  // Ensure it exists — Electron creates it lazily on first write.
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
  shell.openPath(logDir);
}

/**
 * Open the current backend log file directly in the OS default text viewer.
 * Falls back to the logs folder if the file hasn't been created yet (e.g.
 * backend crashed before writing its first line).
 */
function openLogFile() {
  if (pythonBackend && pythonBackend.logFilePath && fs.existsSync(pythonBackend.logFilePath)) {
    shell.openPath(pythonBackend.logFilePath);
  } else {
    openLogsFolder();
  }
}

function buildAppMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { role: "quit", label: "Exit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools", label: "Developer Tools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open Logs Folder",
          click: () => openLogsFolder(),
        },
        {
          label: "Open Backend Log",
          click: () => openLogFile(),
        },
        { type: "separator" },
        {
          label: "Check for Updates…",
          click: () => checkForUpdates({ parentWindow: mainWindow, silent: false }),
        },
        { type: "separator" },
        {
          label: "About CapForge",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About CapForge",
              message: `CapForge ${app.getVersion()}`,
              detail: "Auto subtitle generator with word-by-word alignment.\n\n© 2026 FRScz",
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "CapForge — Setup",
    backgroundColor: "#0d1117",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  setupWindow.removeMenu();
  setupWindow.loadFile(path.join(__dirname, "setup-window.html"));
  return setupWindow;
}

/**
 * Show the first-run wizard. Flow:
 *   1. Welcome screen — GPU detection shown, user clicks "Install"
 *   2. Progress screen — ensureRuntime runs, streaming progress events
 *   3. Done screen — user clicks "Launch CapForge"
 *
 * Resolves when the user dismisses the wizard so the main window can open.
 * Rejects (and quits) on install failure.
 */
async function runFirstTimeSetup() {
  if (isRuntimeReady()) return;

  // GPU detection IPC — the renderer asks for this before the user picks Install.
  ipcMain.handle("setup:detect-accelerator", () => detectAccelerator());

  createSetupWindow();
  await new Promise((resolve) => {
    if (setupWindow.webContents.isLoading()) {
      setupWindow.webContents.once("did-finish-load", resolve);
    } else {
      resolve();
    }
  });

  return new Promise((resolve, reject) => {
    ipcMain.once("setup:begin", async () => {
      try {
        await ensureRuntime({
          onProgress: (p) => {
            if (setupWindow && !setupWindow.isDestroyed()) {
              setupWindow.webContents.send("setup:progress", p);
            }
          },
        });
        if (setupWindow && !setupWindow.isDestroyed()) {
          setupWindow.webContents.send("setup:done");
        }
      } catch (err) {
        if (setupWindow && !setupWindow.isDestroyed()) {
          setupWindow.webContents.send("setup:error", err.message);
        }
        dialog.showErrorBox(
          "CapForge — Setup Failed",
          `First-run setup failed:\n\n${err.message}\n\n` +
          `You can retry by launching CapForge again. If the problem persists, ` +
          `check your internet connection and antivirus settings.`
        );
        app.quit();
        reject(err);
        return;
      }
      ipcMain.once("setup:launch", () => {
        if (setupWindow && !setupWindow.isDestroyed()) {
          setupWindow.close();
          setupWindow = null;
        }
        resolve();
      });
    });
  });
}

app.whenReady().then(async () => {
  // First-run: install embedded Python + whisperx + torch before touching the backend.
  try {
    await runFirstTimeSetup();
  } catch {
    return; // setup already showed an error dialog and quit
  }

  // Start the Python backend
  pythonBackend = new PythonBackend();
  try {
    await pythonBackend.start();
  } catch (err) {
    dialog.showErrorBox(
      "CapForge — Backend Error",
      `Failed to start the Python backend:\n\n${err.message}`
    );
  }

  createWindow();

  // Silent update check ~5s after launch so it never competes with the
  // first paint. Any failure (offline, rate-limited, etc.) is swallowed.
  setTimeout(() => {
    checkForUpdates({ parentWindow: mainWindow, silent: true }).catch(() => {});
  }, 5000);

  // IPC: generic app-state get/set — renderer uses this to persist the
  // last-used preset name and any small bits of UI state.
  ipcMain.handle("state:get", (_e, key, fallback) => appState.get(key, fallback));
  ipcMain.handle("state:set", (_e, key, value) => { appState.set(key, value); return true; });

  // IPC: open logs — used by the Help menu and by error toasts with a
  // "View logs" action in the renderer.
  ipcMain.handle("logs:openFolder", () => { openLogsFolder(); return true; });
  ipcMain.handle("logs:openFile", () => { openLogFile(); return true; });

  // IPC: open file dialog — restore last-used directory as starting point,
  // and remember the chosen file so the renderer can reopen it next launch.
  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Audio File",
      defaultPath: appState.get("lastInputPath") || undefined,
      filters: [
        {
          name: "Audio / Video",
          extensions: [
            "mp3", "wav", "m4a", "flac", "ogg", "wma",
            "mp4", "mkv", "avi", "mov", "webm",
          ],
        },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const picked = result.filePaths[0];
    appState.set("lastInputPath", picked);
    return picked;
  });

  // IPC: open directory dialog — same persistence pattern.
  ipcMain.handle("dialog:openDir", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Output Directory",
      defaultPath: appState.get("lastOutputDir") || undefined,
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    const picked = result.filePaths[0];
    appState.set("lastOutputDir", picked);
    return picked;
  });

  // IPC: get backend port
  ipcMain.handle("backend:port", () => {
    return pythonBackend ? pythonBackend.port : 8000;
  });

  // IPC: save a font file to persistent storage (receives binary data + filename)
  const fontsDir = path.join(app.getPath("userData"), "fonts");
  const bundledFontsDir = app.isPackaged
    ? path.join(process.resourcesPath, "Fonts")
    : path.join(__dirname, "..", "Fonts");
  ipcMain.handle("fonts:save", async (_event, fileName, dataBuffer) => {
    if (!fileName || !dataBuffer) return null;
    // Sanitize filename — keep only the basename
    const safeName = path.basename(fileName);
    if (!safeName) return null;
    if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });
    const dest = path.join(fontsDir, safeName);
    fs.writeFileSync(dest, Buffer.from(dataBuffer));
    return dest;
  });

  // IPC: list all saved fonts
  const FONT_EXTS = [".ttf", ".otf", ".woff", ".woff2"];
  ipcMain.handle("fonts:list", async () => {
    if (!fs.existsSync(fontsDir)) return [];
    return fs.readdirSync(fontsDir)
      .filter(f => FONT_EXTS.includes(path.extname(f).toLowerCase()))
      .map(f => ({ name: f.replace(/\.[^.]+$/, ""), path: path.join(fontsDir, f) }));
  });

  // IPC: list fonts shipped with the app (read-only bundle)
  ipcMain.handle("fonts:listBundled", async () => {
    if (!fs.existsSync(bundledFontsDir)) return [];
    return fs.readdirSync(bundledFontsDir)
      .filter(f => FONT_EXTS.includes(path.extname(f).toLowerCase()))
      .map(f => ({ name: f.replace(/\.[^.]+$/, ""), path: path.join(bundledFontsDir, f) }));
  });

  // IPC: delete a saved font
  ipcMain.handle("fonts:delete", async (_event, fontPath) => {
    if (!fontPath || !fontPath.startsWith(fontsDir)) return false;
    if (fs.existsSync(fontPath)) { fs.unlinkSync(fontPath); return true; }
    return false;
  });

  // IPC: read a font file as ArrayBuffer (user dir or bundled dir)
  ipcMain.handle("fonts:read", async (_event, fontPath) => {
    if (!fontPath || !fs.existsSync(fontPath)) return null;
    const allowed = fontPath.startsWith(fontsDir) || fontPath.startsWith(bundledFontsDir);
    if (!allowed) return null;
    return fs.readFileSync(fontPath).buffer;
  });

  // IPC: Style presets (stored as JSON in userData)
  const presetsFile = path.join(app.getPath("userData"), "presets.json");

  function readPresets() {
    if (!fs.existsSync(presetsFile)) return {};
    try { return JSON.parse(fs.readFileSync(presetsFile, "utf-8")); } catch { return {}; }
  }

  function writePresets(data) {
    fs.writeFileSync(presetsFile, JSON.stringify(data, null, 2), "utf-8");
  }

  ipcMain.handle("presets:list", async () => {
    const data = readPresets();
    return Object.keys(data);
  });

  ipcMain.handle("presets:load", async (_event, name) => {
    const data = readPresets();
    return data[name] || null;
  });

  ipcMain.handle("presets:save", async (_event, name, settings) => {
    const data = readPresets();
    data[name] = settings;
    writePresets(data);
    return true;
  });

  ipcMain.handle("presets:delete", async (_event, name) => {
    const data = readPresets();
    delete data[name];
    writePresets(data);
    return true;
  });

  // IPC: Save project file (.capforge)
  ipcMain.handle("project:save", async (_event, projectData) => {
    const lastProject = appState.get("lastProjectPath");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save CapForge Project",
      defaultPath: lastProject || projectData.suggestedName || "project.capforge",
      filters: [
        { name: "CapForge Project", extensions: ["capforge"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(projectData, null, 2), "utf-8");
    appState.set("lastProjectPath", result.filePath);
    return result.filePath;
  });

  // IPC: Open project file (.capforge)
  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open CapForge Project",
      defaultPath: appState.get("lastProjectPath") || undefined,
      filters: [
        { name: "CapForge Project", extensions: ["capforge"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    data._filePath = filePath;
    appState.set("lastProjectPath", filePath);
    return data;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (pythonBackend) {
    pythonBackend.stop();
  }
});
