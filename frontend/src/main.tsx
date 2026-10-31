import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiProvider } from "./api/api-context.tsx";
import { createApiClient } from "./api/client.ts";
import { App } from "./app.tsx";
import "./global.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html has no #root element.");
}

const queryClient = new QueryClient();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={createApiClient(window.location.origin)}>
        <App />
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
