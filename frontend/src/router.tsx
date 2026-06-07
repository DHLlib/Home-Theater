import { createBrowserRouter } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Detail from "./pages/Detail";
import Player from "./pages/Player";
import Downloads from "./pages/Downloads";
import Favorites from "./pages/Favorites";
import Progress from "./pages/Progress";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";

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
