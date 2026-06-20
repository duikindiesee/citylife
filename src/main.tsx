import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./ui/styles.css";

// No StrictMode on purpose: it double-invokes effects in dev, which would
// double-initialise the three.js renderer and the sim loop.
createRoot(document.getElementById("root")!).render(<App />);
