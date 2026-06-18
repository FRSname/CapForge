/**
 * Pure-logic tests for claude-connect. Run with the built-in node runner:
 *   node --test electron/claude-connect.test.js
 * No electron required — only the import-safe helpers are exercised.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildServerEntryFrom,
  mergeMcpServers,
  desktopConfigPath,
  codeConfigPath,
} = require("./claude-connect");

test("buildServerEntryFrom wires command, module args, cwd and PYTHONPATH", () => {
  const entry = buildServerEntryFrom("/runtime/python", "/proj");
  assert.equal(entry.command, "/runtime/python");
  assert.deepEqual(entry.args, ["-m", "mcp_server.server"]);
  assert.equal(entry.cwd, "/proj");
  assert.equal(entry.env.PYTHONPATH, "/proj");
});

test("mergeMcpServers adds capforge to an empty config", () => {
  const out = mergeMcpServers({}, { command: "py" });
  assert.deepEqual(out, { mcpServers: { capforge: { command: "py" } } });
});

test("mergeMcpServers preserves existing servers and other top-level keys", () => {
  const existing = {
    theme: "dark",
    mcpServers: { other: { command: "x" } },
  };
  const out = mergeMcpServers(existing, { command: "py" });
  assert.equal(out.theme, "dark");
  assert.deepEqual(out.mcpServers.other, { command: "x" });
  assert.deepEqual(out.mcpServers.capforge, { command: "py" });
  // input not mutated
  assert.equal(existing.mcpServers.capforge, undefined);
});

test("mergeMcpServers overwrites a stale capforge entry", () => {
  const out = mergeMcpServers(
    { mcpServers: { capforge: { command: "old" } } },
    { command: "new" }
  );
  assert.deepEqual(out.mcpServers.capforge, { command: "new" });
});

test("mergeMcpServers tolerates a null/garbage config", () => {
  assert.deepEqual(mergeMcpServers(null, { command: "py" }), {
    mcpServers: { capforge: { command: "py" } },
  });
});

test("config paths are absolute and client-correct", () => {
  assert.ok(path_isAbsolute(desktopConfigPath()));
  assert.match(desktopConfigPath(), /claude_desktop_config\.json$/);
  assert.match(codeConfigPath(), /\.claude\.json$/);
});

function path_isAbsolute(p) {
  return require("node:path").isAbsolute(p);
}
