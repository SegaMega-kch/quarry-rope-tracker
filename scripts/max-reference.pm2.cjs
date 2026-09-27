const { isAbsolute, resolve } = require("node:path");

const config = process.env.MAX_REFERENCE_CONFIG;
const ca = process.env.MAX_REFERENCE_CA_FILE;
if (!config || !isAbsolute(config) || !ca || !isAbsolute(ca)) {
  throw new Error("Set absolute MAX_REFERENCE_CONFIG and MAX_REFERENCE_CA_FILE paths before starting the reference worker");
}

module.exports = {
  apps: [{
    name: "raport-max-reference",
    cwd: resolve(__dirname, ".."),
    script: "node_modules/tsx/dist/cli.mjs",
    args: ["scripts/run-max-reference.ts", "--config", config, "--mode", "run", "--send"],
    interpreter: "node",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    restart_delay: 30000,
    min_uptime: 60000,
    max_restarts: 10,
    kill_timeout: 70000,
    time: true,
    env: { NODE_EXTRA_CA_CERTS: ca }
  }]
};
