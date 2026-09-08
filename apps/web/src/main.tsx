import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app.js";
import { startOfflineReplay } from "./offline.js";
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
      retry: 2,
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
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

startOfflineReplay();
