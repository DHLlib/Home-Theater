import { createBrowserRouter } from "react-router-dom";
import { lazy } from "react";
import Layout from "../components/Layout";
import Home from "../pages/Home";

const Search = lazy(() => import("../pages/Search"));
const Detail = lazy(() => import("../pages/Detail"));
const Player = lazy(() => import("../pages/Player"));
const Downloads = lazy(() => import("../pages/Downloads"));
const Favorites = lazy(() => import("../pages/Favorites"));
const Progress = lazy(() => import("../pages/Progress"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const Settings = lazy(() => import("../pages/Settings"));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "search", element: <Search /> },
      { path: "detail", element: <Detail /> },
      { path: "player", element: <Player /> },
      { path: "downloads", element: <Downloads /> },
      { path: "favorites", element: <Favorites /> },
      { path: "progress", element: <Progress /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);
