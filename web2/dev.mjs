// One command for development: Hono API on :4001 + Vite dev server on :3001.
import { spawn } from "node:child_process";
import process from "node:process";

const procs = [
  spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], { stdio: "inherit" }),
];

for (const p of procs) {
  p.on("exit", (code) => {
    for (const other of procs) other.kill();
    if (code !== 0) process.exitCode = code ?? 1;
  });
}
process.on("SIGINT", () => {
  for (const p of procs) p.kill();
  process.exit(0);
});
