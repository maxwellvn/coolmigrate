#!/usr/bin/env node
// coolmigrate: start the server, open the browser, exit on Ctrl+C.
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
if (args.includes("--help") || args.includes("-h")) {
  console.log("coolmigrate [--port 3456] [--host 127.0.0.1] [--no-open] [--data ~/.coolmigrate]");
  process.exit(0);
}
const port = flag("--port", process.env.PORT || "3456");
const host = flag("--host", "127.0.0.1");
const home = flag("--data", process.env.COOLMIGRATE_HOME || path.join(require("node:os").homedir(), ".coolmigrate"));
fs.mkdirSync(home, { recursive: true });

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone", "server.js");
if (!fs.existsSync(standalone)) {
  console.error("Build missing. Run `npm run build` in " + root + " (or reinstall the package).");
  process.exit(1);
}
const env = { ...process.env, PORT: port, HOSTNAME: host, COOLMIGRATE_HOME: home, NODE_ENV: "production" };
const child = spawn(process.execPath, [standalone], { env, stdio: "inherit" });
child.on("exit", (code) => { console.log("coolmigrate stopped."); process.exit(code ?? 0); });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
const waitThenOpen = (tries = 50) => {
  http.get(url + "/api/instances", (res) => { res.resume(); ready(); }).on("error", () => tries > 0 ? setTimeout(() => waitThenOpen(tries - 1), 200) : ready());
};
const ready = () => {
  console.log(`coolmigrate running at ${url}  (data: ${home})  Ctrl+C to stop`);
  if (args.includes("--no-open")) return;
  const opener = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try { execFileSync(opener[0], opener.slice(1), { stdio: "ignore" }); } catch { /* headless box: URL is printed above */ }
};
waitThenOpen();
