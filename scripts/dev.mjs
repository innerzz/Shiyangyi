import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const backendEnvPath = path.join(root, "backend", ".env");
const env = { ...process.env, NEXT_PUBLIC_PROCESSING_API_BASE: "http://127.0.0.1:8000" };

if (fs.existsSync(backendEnvPath)) {
  for (const rawLine of fs.readFileSync(backendEnvPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const split = line.indexOf("=");
    const key = line.slice(0, split).trim();
    const value = line.slice(split + 1).trim();
    if (key && !(key in env)) env[key] = value;
  }
}

const python = path.join(root, ".backend-venv", "bin", "python3");
if (!fs.existsSync(python)) {
  console.error("缺少 .backend-venv，请先按照 README 安装后端依赖。");
  process.exit(1);
}

const children = [
  spawn(python, ["-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", "8000"], { cwd: root, env, stdio: "inherit" }),
  spawn("npm", ["run", "dev:web"], { cwd: root, env, stdio: "inherit" }),
];

const shutdown = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
}
