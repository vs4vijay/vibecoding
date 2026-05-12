import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import type { MediAssistClient } from "../api/client.ts";
import { Tabs, type Tab } from "./components/tabs.tsx";
import { Footer, type KeyHint } from "./components/footer.tsx";
import { HelpOverlay } from "./components/help-overlay.tsx";
import { Dashboard } from "./dashboard.tsx";
import { ClaimsList } from "./claims-list.tsx";
import { NewClaim } from "./new-claim.tsx";

type ScreenKey = "dashboard" | "claims" | "newClaim";

const TABS: Tab[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "claims", label: "Claims" },
  { key: "newClaim", label: "New Claim" },
];

type AppProps = { client: MediAssistClient };

export function App({ client }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<ScreenKey>("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);
  const [help, setHelp] = useState(false);

  useInput((input, key) => {
    // Help overlay swallows other input
    if (help) {
      if (input === "?" || key.escape) setHelp(false);
      return;
    }

    if (input === "?") {
      setHelp(true);
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (input === "r") {
      setRefreshKey((n) => n + 1);
      return;
    }
    // Tab switches by number or letter
    if (input === "1") setScreen("dashboard");
    else if (input === "2") setScreen("claims");
    else if (input === "3") setScreen("newClaim");
    else if (key.tab) {
      const idx = TABS.findIndex((t) => t.key === screen);
      const next = TABS[(idx + 1) % TABS.length]!.key as ScreenKey;
      setScreen(next);
    }
  });

  return (
    <Box flexDirection="column">
      <Tabs tabs={TABS} activeKey={screen} />
      <Box marginTop={1}>
        {screen === "dashboard" && <Dashboard client={client} refreshKey={refreshKey} />}
        {screen === "claims" && (
          <ClaimsList client={client} refreshKey={refreshKey} isFocused={!help} />
        )}
        {screen === "newClaim" && <NewClaim client={client} isFocused={!help} />}
      </Box>
      <Footer hints={footerHintsFor(screen)} />
      {help ? (
        <Box marginTop={1}>
          <HelpOverlay
            groups={[
              {
                title: "Global",
                keys: [
                  { key: "1 / 2 / 3", desc: "Switch tabs" },
                  { key: "tab", desc: "Cycle tabs" },
                  { key: "?", desc: "Toggle help" },
                  { key: "r", desc: "Refresh" },
                  { key: "q", desc: "Quit" },
                ],
              },
              {
                title: "Claims list",
                keys: [
                  { key: "j / ↓", desc: "Next row" },
                  { key: "k / ↑", desc: "Previous row" },
                  { key: "g", desc: "Top" },
                  { key: "G", desc: "Bottom" },
                  { key: "PgUp/PgDn", desc: "Jump 10 rows" },
                  { key: "enter / l", desc: "View detail" },
                  { key: "esc / h", desc: "Hide detail" },
                ],
              },
              {
                title: "New claim",
                keys: [
                  { key: "drag&drop", desc: "Drop file on terminal" },
                  { key: "type", desc: "Or type a file path" },
                  { key: "enter", desc: "Extract / confirm / dry-run" },
                  { key: "j/k or ↑/↓", desc: "Pick beneficiary" },
                  { key: "esc", desc: "Back / start over" },
                ],
              },
            ]}
          />
        </Box>
      ) : null}
    </Box>
  );
}

function footerHintsFor(screen: ScreenKey): KeyHint[] {
  const base: KeyHint[] = [
    { key: "1-3", label: "tabs" },
    { key: "tab", label: "next tab" },
    { key: "r", label: "refresh" },
    { key: "?", label: "help" },
    { key: "q", label: "quit" },
  ];
  if (screen === "claims") {
    return [
      { key: "j/k", label: "move" },
      { key: "↵", label: "view" },
      { key: "g/G", label: "top/bot" },
      ...base,
    ];
  }
  return base;
}
