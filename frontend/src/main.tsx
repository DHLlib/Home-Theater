import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/global.css";
import { clearExpiredCache } from "./utils/cache";
import { queryClient } from "./lib/queryClient";

// index.html 的兜底脚本据此判断入口模块是否已经执行（没执行才重载）
(window as Window & { __HT_BOOTED__?: boolean }).__HT_BOOTED__ = true;

clearExpiredCache().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
