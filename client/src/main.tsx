import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// No StrictMode: its dev-only double mount would open and close multiplayer connections.
createRoot(document.getElementById("root")!).render(<App />);
