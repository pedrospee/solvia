// npm run dev: the API and the UI's dev server together (docs/development.md). Ctrl+C stops
// both, and when either one exits the other is stopped too, so no server is left running alone.
import { type ChildProcess, spawn } from "node:child_process";

const servers: ChildProcess[] = ["@solvia/backend", "@solvia/frontend"].map((workspace) =>
  spawn("npm", ["run", "dev", `--workspace=${workspace}`], { stdio: "inherit" }),
);

let stopping = false;

// The signal the user sent (Ctrl+C is SIGINT) is passed on as is: servers stopped that way
// exit quietly, where a different one makes npm report a failed script.
function stopAll(signal: NodeJS.Signals = "SIGINT"): void {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const server of servers) {
    if (server.exitCode === null) {
      server.kill(signal);
    }
  }
}

for (const server of servers) {
  server.on("exit", (code) => {
    // A server that stops on its own (a crash, a missing database) fails the whole command.
    if (!stopping) {
      process.exitCode = code ?? 1;
    }
    stopAll();
  });
}
process.once("SIGINT", () => stopAll("SIGINT"));
process.once("SIGTERM", () => stopAll("SIGTERM"));
