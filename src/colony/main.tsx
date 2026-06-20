import { createRoot } from "react-dom/client";
import { ColonyApp } from "./ui/ColonyApp";
import { AuthGate } from "./ui/AuthGate";

createRoot(document.getElementById("root")!).render(
  <AuthGate>
    <ColonyApp />
  </AuthGate>,
);
