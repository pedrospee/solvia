import { chmodSync, mkdirSync } from "node:fs";

// The database, backups and exports hold real financial data (docs/security.md): only
// the user who owns them may read them. Modes are set explicitly, never left to the
// process umask, and existing files and directories are tightened too.

const PRIVATE_DIRECTORY = 0o700;
const PRIVATE_FILE = 0o600;

/** Creates the directory and any missing parents as 700, and tightens it if it exists. */
export function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY });
  chmodSync(path, PRIVATE_DIRECTORY);
}

export function makePrivateFile(path: string): void {
  chmodSync(path, PRIVATE_FILE);
}
