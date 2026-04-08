/**
 * CapForge — Electron main process.
 * Spawns the Python FastAPI backend and opens the renderer window.
 */

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { PythonBackend } = require("./python-manager");

let mainWindow = null;
let pythonBackend = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 1400,
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
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.removeMenu();

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Open DevTools in dev mode
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Start the Python backend
  pythonBackend = new PythonBackend();
  try {
    await pythonBackend.start();
  } catch (err) {
    dialog.showErrorBox(
      "CapForge — Backend Error",
      `Failed to start the Python backend:\n\n${err.message}\n\nMake sure Python 3.10+ and the whisperx venv are set up.`
    );
  }

  createWindow();

  // IPC: open file dialog
  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Audio File",
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
    return result.canceled ? null : result.filePaths[0];
  });

  // IPC: open directory dialog
  ipcMain.handle("dialog:openDir", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Output Directory",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // IPC: get backend port
  ipcMain.handle("backend:port", () => {
    return pythonBackend ? pythonBackend.port : 8000;
  });

  // IPC: save a font file to persistent storage (receives binary data + filename)
  const fontsDir = path.join(app.getPath("userData"), "fonts");
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
  ipcMain.handle("fonts:list", async () => {
    if (!fs.existsSync(fontsDir)) return [];
    const exts = [".ttf", ".otf", ".woff", ".woff2"];
    return fs.readdirSync(fontsDir)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .map(f => ({ name: f.replace(/\.[^.]+$/, ""), path: path.join(fontsDir, f) }));
  });

  // IPC: delete a saved font
  ipcMain.handle("fonts:delete", async (_event, fontPath) => {
    if (!fontPath || !fontPath.startsWith(fontsDir)) return false;
    if (fs.existsSync(fontPath)) { fs.unlinkSync(fontPath); return true; }
    return false;
  });

  // IPC: read a font file as ArrayBuffer
  ipcMain.handle("fonts:read", async (_event, fontPath) => {
    if (!fontPath || !fontPath.startsWith(fontsDir) || !fs.existsSync(fontPath)) return null;
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
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save CapForge Project",
      defaultPath: projectData.suggestedName || "project.capforge",
      filters: [
        { name: "CapForge Project", extensions: ["capforge"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(projectData, null, 2), "utf-8");
    return result.filePath;
  });

  // IPC: Open project file (.capforge)
  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open CapForge Project",
      filters: [
        { name: "CapForge Project", extensions: ["capforge"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const content = fs.readFileSync(result.filePaths[0], "utf-8");
    const data = JSON.parse(content);
    data._filePath = result.filePaths[0];
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
