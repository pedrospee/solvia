import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ApiProvider } from "./api/api-context.tsx";
import { createApiClient } from "./api/client.ts";
import { createQueryClient } from "./api/query-client.ts";
import { App } from "./app.tsx";
import "./global.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html has no #root element.");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <ApiProvider client={createApiClient(window.location.origin)}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
