import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { subscribe, type ToastType } from "./utils/toast";
import { connectSse, disconnectSse } from "./api/sse";

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

export default function App() {
  useEffect(() => {
    // 初始化主题（优先 localStorage，其次系统偏好）
    const saved = localStorage.getItem("theme");
    if (saved) {
      document.documentElement.setAttribute("data-theme", saved);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      localStorage.setItem("theme", "light");
    }
  }, []);

  useEffect(() => {
    connectSse();
    return () => disconnectSse();
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      <ToastContainer />
    </>
  );
}
