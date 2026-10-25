import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";

// Real data must live outside the repository, so relative paths (resolved from
// wherever a script happens to run) are rejected.
const absolutePath = z.string().min(1).refine(isAbsolute, { message: "must be an absolute path" });

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_PATH: absolutePath,
    BACKUP_DIR: absolutePath,
    // Where `npm run data:export` writes; next to BACKUP_DIR when left out.
    EXPORT_DIR: absolutePath.optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  })
  .transform((environment) => ({
    ...environment,
    EXPORT_DIR: environment.EXPORT_DIR ?? join(dirname(environment.BACKUP_DIR), "exports"),
  }));

export type Environment = z.infer<typeof environmentSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(issues: string) {
    super(`Invalid environment configuration:\n${issues}`);
    this.name = "InvalidEnvironmentError";
  }
}

/**
 * Validates environment variables once at startup so the rest of the
 * application can rely on a typed, known-good configuration.
 */
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    throw new InvalidEnvironmentError(z.prettifyError(result.error));
  }

  return result.data;
}
