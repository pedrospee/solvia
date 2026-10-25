import { describe, expect, it } from "vitest";
import { InvalidEnvironmentError, loadEnvironment } from "./environment.ts";

const requiredPaths = {
  DATABASE_PATH: "/var/solvia/solvia.db",
  BACKUP_DIR: "/var/solvia/backups",
};

describe("loadEnvironment", () => {
  it("applies defaults for NODE_ENV and PORT", () => {
    expect(loadEnvironment(requiredPaths)).toEqual({
      NODE_ENV: "development",
      PORT: 3000,
      ...requiredPaths,
      EXPORT_DIR: "/var/solvia/exports",
    });
  });

  it("puts exports next to the backup directory unless EXPORT_DIR is set", () => {
    expect(loadEnvironment(requiredPaths).EXPORT_DIR).toBe("/var/solvia/exports");
    expect(
      loadEnvironment({ ...requiredPaths, EXPORT_DIR: "/Volumes/Private/exports" }).EXPORT_DIR,
    ).toBe("/Volumes/Private/exports");
    expect(() => loadEnvironment({ ...requiredPaths, EXPORT_DIR: "exports" })).toThrow(
      InvalidEnvironmentError,
    );
  });

  it("accepts a supported NODE_ENV and a numeric PORT", () => {
    const environment = loadEnvironment({ ...requiredPaths, NODE_ENV: "production", PORT: "4100" });

    expect(environment.NODE_ENV).toBe("production");
    expect(environment.PORT).toBe(4100);
  });

  it("rejects an unsupported NODE_ENV", () => {
    expect(() => loadEnvironment({ ...requiredPaths, NODE_ENV: "staging" })).toThrow(
      InvalidEnvironmentError,
    );
  });

  it("requires DATABASE_PATH and BACKUP_DIR", () => {
    expect(() => loadEnvironment({})).toThrow(InvalidEnvironmentError);
    expect(() => loadEnvironment({ DATABASE_PATH: requiredPaths.DATABASE_PATH })).toThrow(
      InvalidEnvironmentError,
    );
  });

  it("rejects relative database and backup paths", () => {
    expect(() => loadEnvironment({ ...requiredPaths, DATABASE_PATH: "data/solvia.db" })).toThrow(
      InvalidEnvironmentError,
    );
    expect(() => loadEnvironment({ ...requiredPaths, BACKUP_DIR: "./backups" })).toThrow(
      InvalidEnvironmentError,
    );
  });

  it("rejects a PORT outside the valid range", () => {
    expect(() => loadEnvironment({ ...requiredPaths, PORT: "70000" })).toThrow(
      InvalidEnvironmentError,
    );
    expect(() => loadEnvironment({ ...requiredPaths, PORT: "abc" })).toThrow(
      InvalidEnvironmentError,
    );
  });
});
