import { useApp, useInput } from "ink";
import { useState } from "react";
import type { MediAssistClient } from "../api/client.ts";
import { Dashboard } from "./dashboard.tsx";

export type Screen = "dashboard" | "claims" | "newClaim";

type AppProps = {
  client: MediAssistClient;
  initialScreen?: Screen;
};

export function App({ client, initialScreen = "dashboard" }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(initialScreen);

  useInput((input) => {
    const k = input.toLowerCase();
    if (k === "q") exit();
  });

  switch (screen) {
    case "dashboard":
      return <Dashboard client={client} onNavigate={setScreen} />;
    default:
      // Placeholder while we build the other screens.
      return <Dashboard client={client} onNavigate={setScreen} />;
  }
}
