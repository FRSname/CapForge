/**
 * Manages the Python FastAPI backend as a child process.
 */

const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const PROJECT_ROOT = path.join(__dirname, "..");
const PORT = 8000;

// Locate the venv Python executable
function findPython() {
  const venvPython = path.join(PROJECT_ROOT, "whisperx", "Scripts", "python.exe");
  const fs = require("fs");
  if (fs.existsSync(venvPython)) return venvPython;
  // Fallback: hope system python has deps
  return "python";
}

class PythonBackend {
  constructor() {
    this.process = null;
    this.port = PORT;
    this._output = [];
  }

  /** Start the uvicorn server. Resolves when the server is reachable. */
  start() {
    return new Promise((resolve, reject) => {
      const python = findPython();
      console.log(`[SubForge] Starting backend: ${python}`);

      this.process = spawn(
        python,
        ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(this.port)],
        { cwd: PROJECT_ROOT, windowsHide: true }
      );

      this.process.stdout.on("data", (data) => {
        const line = data.toString();
        this._output.push(line);
        console.log(`[backend] ${line.trim()}`);
      });

      this.process.stderr.on("data", (data) => {
        const line = data.toString();
        this._output.push(line);
        console.log(`[backend] ${line.trim()}`);
      });

      this.process.on("error", (err) => {
        reject(new Error(`Failed to spawn Python: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        console.log(`[SubForge] Backend exited with code ${code}`);
        this.process = null;
      });

      // Poll until the server responds
      this._waitForReady(resolve, reject, 30_000);
    });
  }

  /** Stop the backend process. */
  stop() {
    if (!this.process) return;
    try {
      const treeKill = require("tree-kill");
      treeKill(this.process.pid);
    } catch {
      this.process.kill();
    }
    this.process = null;
  }

  /** Poll the health endpoint until it responds or timeout. */
  _waitForReady(resolve, reject, timeoutMs) {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Backend did not start in time.\n\n" + this._output.join("")));
        return;
      }
      const req = http.get(`http://127.0.0.1:${this.port}/api/status`, (res) => {
        if (res.statusCode === 200) {
          console.log("[SubForge] Backend is ready.");
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });
      req.on("error", () => setTimeout(check, 500));
    };
    setTimeout(check, 1000); // Give it a moment to start
  }
}

module.exports = { PythonBackend };
