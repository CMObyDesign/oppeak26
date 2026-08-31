import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initIframeResize } from "./lib/iframe-resize";

// When embedded in a funnel iframe, keep the parent frame sized to match
// our content so the viewer sees exactly one scrollbar (the parent's).
initIframeResize();

createRoot(document.getElementById("root")!).render(<App />);

