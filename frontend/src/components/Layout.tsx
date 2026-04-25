import { NavLink, Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <div>
      <nav>
        <NavLink to="/" end>首页</NavLink>
        <NavLink to="/search">搜索</NavLink>
        <NavLink to="/favorites">收藏</NavLink>
        <NavLink to="/progress">最近</NavLink>
        <NavLink to="/downloads">下载</NavLink>
        <NavLink to="/settings">设置</NavLink>
      </nav>
      <main style={{ padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
