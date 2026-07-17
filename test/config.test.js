const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("chat posting defaults to one message per minute", () => {
  const configPath = path.join(__dirname, "..", "config.js");
  const output = execFileSync(process.execPath, ["-e", `process.stdout.write(String(require(${JSON.stringify(configPath)}).config.chatRateLimitMaxMessages))`], {
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  });

  assert.equal(output, "1");
});
