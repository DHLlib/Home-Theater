import { useMemo } from "react";
import { isMobileUA } from "./utils/ua";
import DesktopApp from "./desktop/App";
import MobileApp from "./mobile/App";

export default function App() {
  const isMobile = useMemo(() => isMobileUA(), []);
  return isMobile ? <MobileApp /> : <DesktopApp />;
}
