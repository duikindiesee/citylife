import { createRoot } from "react-dom/client";
import { ColonyApp } from "./ui/ColonyApp";
import { AuthGate } from "./ui/AuthGate";
import { StarterWorldGate } from "./ui/StarterWorldGate";

createRoot(document.getElementById("root")!).render(
  <AuthGate>
    <StarterWorldGate>{inventory => <ColonyApp playerInventory={inventory} />}</StarterWorldGate>
  </AuthGate>,
);
