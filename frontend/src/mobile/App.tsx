import { useEffect, Suspense } from "react";
import { RouterProvider } from "react-router-dom";
import { useState } from "react";
import { router } from "./router";
import { subscribe, type ToastType } from "../utils/toast";
import { connectSse, disconnectSse } from "../api/sse";
import { applyTheme, getStoredTheme } from "../lib/theme";
import "./styles/mobile.css";

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
    <div className="mobile-toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`mobile-toast ${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function PageLoading() {
  return (
    <div className="mobile-page-loading">
      <div className="spinner" />
    </div>
  );
}

export default function MobileApp() {
  useEffect(() => {
    localStorage.removeItem("theme");
    applyTheme(getStoredTheme());
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
