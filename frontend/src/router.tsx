import { createBrowserRouter } from "react-router-dom";
import { lazyWithRetry } from "./utils/chunkReload";
import Layout from "./components/Layout";
import Home from "./pages/Home";

const Search = lazyWithRetry(() => import("./pages/Search"));
const Detail = lazyWithRetry(() => import("./pages/Detail"));
const Player = lazyWithRetry(() => import("./pages/Player"));
const Downloads = lazyWithRetry(() => import("./pages/Downloads"));
const Favorites = lazyWithRetry(() => import("./pages/Favorites"));
const Progress = lazyWithRetry(() => import("./pages/Progress"));
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const Settings = lazyWithRetry(() => import("./pages/Settings"));

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
