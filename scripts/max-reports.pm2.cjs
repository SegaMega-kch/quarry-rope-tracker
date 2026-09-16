const { isAbsolute, resolve } = require("node:path");

const config = process.env.MAX_REPORT_CONFIG;
const ca = process.env.MAX_REPORT_CA_FILE;
if (!config || !isAbsolute(config) || !ca || !isAbsolute(ca)) {
  throw new Error("Set absolute MAX_REPORT_CONFIG and MAX_REPORT_CA_FILE paths before starting the report worker");
}

module.exports = {
  apps: [{
    name: "raport-max-reports",
    cwd: resolve(__dirname, ".."),
    script: "node_modules/tsx/dist/cli.mjs",
    args: ["scripts/run-max-reports.ts", "--config", config, "--mode", "run", "--send"],
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
