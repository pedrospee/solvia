import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library cannot clean up by itself.
afterEach(() => {
  cleanup();
});
