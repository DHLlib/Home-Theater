import { useEffect, Suspense } from "react";
import { RouterProvider } from "react-router-dom";
import { useState } from "react";
import { router } from "./router";
import { subscribe, type ToastType } from "../utils/toast";
import { connectSse, disconnectSse } from "../api/sse";
import { applyTheme, getStoredTheme } from "../lib/theme";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => {
    return subscribe(setToasts);
  }, []);
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function PageLoading() {
  return (
    <div
      className="page-loading"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div className="spinner" />
    </div>
  );
}

export default function DesktopApp() {
  useEffect(() => {
    localStorage.removeItem("theme");
    applyTheme(getStoredTheme());
  }, []);

  useEffect(() => {
    // 无头截图（?capture=1）时不建立 SSE 长连接：长连接会让页面永远到不了 idle
    if (new URLSearchParams(window.location.search).has("capture")) return;
    connectSse();
    return () => disconnectSse();
  }, []);

  return (
    <>
      <Suspense fallback={<PageLoading />}>
        <RouterProvider router={router} />
      </Suspense>
      <ToastContainer />
    </>
  );
}
