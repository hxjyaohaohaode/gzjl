import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app.js";
import { WorkspaceErrorBoundary } from "./error-boundary.js";
import "./styles.css";

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      // Dependent screens must refetch on navigation even without WebSocket.
      // The mutation's own handler reconciles its active view; refetching here
      // would race its optimistic updates and duplicate requests.
      void queryClient.invalidateQueries({ refetchType: "none" });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // api() already bounds safe-read retries. Retrying again here multiplies
      // delays and repeats permanent validation/authorization failures.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Application root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <WorkspaceErrorBoundary><App /></WorkspaceErrorBoundary>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installing the optional offline shell must not break the online app.
    });
  });
}
