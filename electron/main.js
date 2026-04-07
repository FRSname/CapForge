/**
 * SubForge — Electron main process.
 * Spawns the Python FastAPI backend and opens the renderer window.
 */

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { PythonBackend } = require("./python-manager");

let mainWindow = null;
let pythonBackend = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    title: "SubForge",
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
      "SubForge — Backend Error",
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
