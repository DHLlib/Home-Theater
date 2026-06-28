import { createBrowserRouter, Outlet } from "react-router-dom";
import { lazy } from "react";
import MobileNav from "./components/MobileNav";
import MobileHome from "./pages/MobileHome";

const MobileSearch = lazy(() => import("./pages/MobileSearch"));
const MobileFavorites = lazy(() => import("./pages/MobileFavorites"));
const MobileDownloads = lazy(() => import("./pages/MobileDownloads"));
const MobileMe = lazy(() => import("./pages/MobileMe"));
const MobileProgress = lazy(() => import("./pages/MobileProgress"));
const MobileSettings = lazy(() => import("../pages/Settings"));
const MobileDetailView = lazy(() => import("./components/MobileDetailView"));
const Player = lazy(() => import("../pages/Player"));

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
