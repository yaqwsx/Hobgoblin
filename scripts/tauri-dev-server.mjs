import { spawn } from "node:child_process";
import net from "node:net";

const host = "127.0.0.1";
const port = Number(process.env.HOBGOBLIN_DEV_PORT ?? 1420);
const url = `http://${host}:${port}/`;

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function servesHobgoblin() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    return body.includes("<title>Hobgoblin</title>") || body.includes("/src/main.tsx");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function holdForTauri() {
  console.log(`Reusing existing Hobgoblin Vite server at ${url}`);
  console.log("Stop that server separately when you are done.");
  setInterval(() => undefined, 2 ** 31 - 1);
}

function printPortOwnerHelp() {
  console.error(`Port ${port} is already in use, but it does not look like Hobgoblin's Vite server.`);
  console.error("");
  console.error("Find the owning process with:");
  console.error(`  lsof -nP -iTCP:${port} -sTCP:LISTEN`);
  console.error("");
  console.error("Then stop it, or use browser-only dev on a different port:");
  console.error("  npm run dev -- --port 1421");
}

function startVite() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCommand, ["run", "dev:tauri-server"], {
    stdio: "inherit",
    env: {
      ...process.env,
      HOBGOBLIN_DEV_PORT: String(port),
      HOBGOBLIN_STRICT_PORT: "1",
    },
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (await canConnect()) {
  if (await servesHobgoblin()) {
    holdForTauri();
  } else {
    printPortOwnerHelp();
    process.exit(1);
  }
} else {
  startVite();
}
