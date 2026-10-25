import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensurePrivateDirectory, makePrivateFile } from "./private-files.ts";

// docs/security.md: the database, backups and exports hold real financial data, so
// only the user who owns them may read them, whatever the process umask is.

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "solvia-private-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const modeOf = (path: string) => statSync(path).mode & 0o777;

describe("ensurePrivateDirectory", () => {
  it("creates missing directories readable only by the owner (700)", () => {
    const nested = join(workDir, "solvia", "backups");

    ensurePrivateDirectory(nested);

    expect(modeOf(nested)).toBe(0o700);
    expect(modeOf(join(workDir, "solvia"))).toBe(0o700);
  });

  it("tightens an existing directory that others could read", () => {
    const existing = join(workDir, "solvia");
    mkdirSync(existing);
    chmodSync(existing, 0o755);

    ensurePrivateDirectory(existing);

    expect(modeOf(existing)).toBe(0o700);
  });
});

describe("makePrivateFile", () => {
  it("leaves a file readable and writable only by the owner (600)", () => {
    const file = join(workDir, "solvia.db");
    writeFileSync(file, "");
    chmodSync(file, 0o644);

    makePrivateFile(file);

    expect(modeOf(file)).toBe(0o600);
  });
});
