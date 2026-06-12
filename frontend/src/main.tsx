import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/global.css";
import { clearExpiredCache } from "./utils/cache";
import { queryClient } from "./lib/queryClient";

clearExpiredCache().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
