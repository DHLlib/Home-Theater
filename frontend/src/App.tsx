import { useEffect, Suspense } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { subscribe, type ToastType } from "./utils/toast";
import { connectSse, disconnectSse } from "./api/sse";
import { useState } from "react";

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
    <div className="page-loading" style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div className="spinner" />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    // Cinema theme: 强制深黑主题，清除旧主题设置
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("theme");
  }, []);

  useEffect(() => {
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
