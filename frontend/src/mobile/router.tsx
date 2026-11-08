import { createBrowserRouter, Outlet } from "react-router-dom";
import { lazyWithRetry } from "../utils/chunkReload";
import MobileNav from "./components/MobileNav";
import MobileHome from "./pages/MobileHome";

const MobileSearch = lazyWithRetry(() => import("./pages/MobileSearch"));
const MobileFavorites = lazyWithRetry(() => import("./pages/MobileFavorites"));
const MobileDownloads = lazyWithRetry(() => import("./pages/MobileDownloads"));
const MobileMe = lazyWithRetry(() => import("./pages/MobileMe"));
const MobileProgress = lazyWithRetry(() => import("./pages/MobileProgress"));
const MobileSettings = lazyWithRetry(() => import("../pages/Settings"));
const MobileDetailView = lazyWithRetry(() => import("./components/MobileDetailView"));
const Player = lazyWithRetry(() => import("../pages/Player"));

function MobileLayout() {
  return (
    <div className="mobile-layout">
      <main className="mobile-main">
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MobileLayout />,
    children: [
      { index: true, element: <MobileHome /> },
      { path: "search", element: <MobileSearch /> },
      { path: "favorites", element: <MobileFavorites /> },
      { path: "downloads", element: <MobileDownloads /> },
      {
        path: "me",
        children: [
          { index: true, element: <MobileMe /> },
          { path: "progress", element: <MobileProgress /> },
          { path: "settings", element: <MobileSettings /> },
        ],
      },
    ],
  },
  { path: "/detail", element: <MobileDetailView /> },
  { path: "/player", element: <Player /> },
]);
