import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) {
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60_000);
    }
  },
});

createRoot(document.getElementById("root")!).render(<App />);
