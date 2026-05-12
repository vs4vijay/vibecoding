import { Box, Text, useApp, useInput } from "ink";
import { createContext, useCallback, useEffect, useState } from "react";
import { loadSession } from "../api/auth.ts";
import { SessionExpiredError, type MediAssistClient } from "../api/client.ts";
import { listClaims } from "../api/claims.ts";
import { getOpdBalance, getPolicy, type OpdBalance } from "../api/policy.ts";
import { getUserContext, type UserContext } from "../api/user-context.ts";
import type { Claim, Policy } from "../types.ts";
import { Header, type ViewKey } from "./components/header.tsx";
import { KeybindingBar, type KeyHint } from "./components/keybinding-bar.tsx";
import { CommandPalette, type Command } from "./components/command-palette.tsx";
import { HelpOverlay } from "./components/help-overlay.tsx";
import { LoginScreen } from "./login.tsx";
import { Dashboard } from "./dashboard.tsx";
import { ClaimsView } from "./claims-view.tsx";
import { NewClaim } from "./new-claim.tsx";

/**
 * Views consume this context to bubble `SessionExpiredError` up to the
 * shell, which transitions to the LoginScreen for re-auth — all within the
 * same render tree, no process restart.
 */
export const SessionContext = createContext<{ reportExpired: () => void }>({
  reportExpired: () => {},
});

type AuthState =
  | { kind: "checking" }
  | { kind: "login"; reason: "first" | "expired" }
  | { kind: "ready"; client: MediAssistClient };

export function App(): JSX.Element {
  const [auth, setAuth] = useState<AuthState>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await loadSession();
        if (cancelled) return;
        setAuth(client ? { kind: "ready", client } : { kind: "login", reason: "first" });
      } catch {
        if (!cancelled) setAuth({ kind: "login", reason: "first" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (auth.kind === "checking") {
    return (
      <Box padding={1}>
        <Text color="cyan">Checking session…</Text>
      </Box>
    );
  }

  if (auth.kind === "login") {
    return (
      <LoginScreen
        reason={auth.reason}
        onSuccess={(client) => setAuth({ kind: "ready", client })}
      />
    );
  }

  return (
    <Shell
      key={auth.client.cookieString}
      client={auth.client}
      onSessionExpired={() => setAuth({ kind: "login", reason: "expired" })}
    />
  );
}

// ----------------------------------------------------------------------------
// Authenticated shell: header / body / footer with all the views
// ----------------------------------------------------------------------------

type GlobalData = {
  user: UserContext;
  policy: Policy;
  balance: OpdBalance;
  claims: Claim[];
};

type ShellProps = {
  client: MediAssistClient;
  onSessionExpired: () => void;
};

function Shell({ client, onSessionExpired }: ShellProps): JSX.Element {
  const { exit } = useApp();
  const [view, setView] = useState<ViewKey>("dashboard");
  const [data, setData] = useState<GlobalData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const [viewHints, setViewHints] = useState<KeyHint[]>([]);
  const [expiredReported, setExpiredReported] = useState(false);

  const reportExpired = useCallback((): void => {
    setExpiredReported((already) => {
      if (already) return true;
      onSessionExpired();
      return true;
    });
  }, [onSessionExpired]);

  // ----- global data load (header relies on it) -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setData(null);
      setLoadError(null);
      try {
        const [user, policy, balance, claims] = await Promise.all([
          getUserContext(client),
          getPolicy(client),
          getOpdBalance(client),
          listClaims(client),
        ]);
        if (!cancelled) setData({ user, policy, balance, claims });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof SessionExpiredError) {
          reportExpired();
          return;
        }
        setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, refreshKey, reportExpired]);

  // ----- global key bindings -----
  useInput((input, key) => {
    if (palette) return; // CommandPalette owns input
    if (help) {
      if (input === "?" || key.escape) setHelp(false);
      return;
    }
    if (input === "?") {
      setHelp(true);
      return;
    }
    if (input === ":") {
      setPalette(true);
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
    if (input === "1") setView("dashboard");
    else if (input === "2") setView("claims");
    else if (input === "3") setView("newClaim");
    else if (key.tab) {
      setView((v) =>
        v === "dashboard" ? "claims" : v === "claims" ? "newClaim" : "dashboard",
      );
    }
  });

  const commands: Command[] = [
    { name: "dashboard", aliases: ["dash", "1"], description: "Go to dashboard", action: () => setView("dashboard") },
    { name: "claims", aliases: ["c", "2"], description: "Go to claims", action: () => setView("claims") },
    { name: "new", aliases: ["new-claim", "submit", "3"], description: "Start a new claim", action: () => setView("newClaim") },
    { name: "refresh", aliases: ["r"], description: "Refresh data", action: () => setRefreshKey((n) => n + 1) },
    { name: "help", aliases: ["h", "?"], description: "Show help overlay", action: () => setHelp(true) },
    { name: "logout", description: "Sign out and return to the login screen", action: () => onSessionExpired() },
    { name: "quit", aliases: ["q", "exit"], description: "Quit the app", action: () => exit() },
  ];

  const onContextHintsChange = useCallback((hints: KeyHint[]) => {
    setViewHints(hints);
  }, []);

  const isInteractive = !help && !palette;

  return (
    <SessionContext.Provider value={{ reportExpired }}>
      <Box flexDirection="column">
        {data ? (
          <Header user={data.user} policy={data.policy} balance={data.balance} activeView={view} />
        ) : (
          <SimpleHeader status={loadError ? `error: ${loadError}` : "loading…"} />
        )}
        <Box flexGrow={1} flexDirection="column">
          {!data && !loadError ? (
            <Box paddingX={1}>
              <Text color="cyan">Loading…</Text>
            </Box>
          ) : loadError ? (
            <Box paddingX={1} flexDirection="column">
              <Text color="red">Failed to load: {loadError}</Text>
              <Text dimColor>Press [r] to retry · [q] to quit</Text>
            </Box>
          ) : (
            <>
              {view === "dashboard" && (
                <Dashboard policy={data!.policy} balance={data!.balance} claims={data!.claims} />
              )}
              {view === "claims" && (
                <ClaimsView client={client} refreshKey={refreshKey} isActive={isInteractive} />
              )}
              {view === "newClaim" && (
                <NewClaim
                  client={client}
                  user={data!.user}
                  isActive={isInteractive}
                  onContextHintsChange={onContextHintsChange}
                />
              )}
            </>
          )}
        </Box>
        <KeybindingBar contextHints={contextHintsFor(view, viewHints)} />
        {help ? <HelpOverlayContainer onClose={() => setHelp(false)} /> : null}
        {palette ? (
          <Box marginTop={1}>
            <CommandPalette commands={commands} onClose={() => setPalette(false)} />
          </Box>
        ) : null}
      </Box>
    </SessionContext.Provider>
  );
}

function contextHintsFor(view: ViewKey, viewHints: KeyHint[]): KeyHint[] {
  if (viewHints.length > 0) return viewHints;
  switch (view) {
    case "dashboard":
      return [];
    case "claims":
      return [
        { key: "j/k", label: "move" },
        { key: "enter", label: "detail" },
        { key: "tab", label: "pane" },
        { key: "g/G", label: "top/bot" },
      ];
    case "newClaim":
      return [{ key: "drop file", label: "to start" }];
  }
}

function SimpleHeader({ status }: { status: string }): JSX.Element {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold color="cyan">Medi Assist </Text>
      <Text dimColor>· {status}</Text>
    </Box>
  );
}

function HelpOverlayContainer({ onClose }: { onClose: () => void }): JSX.Element {
  useInput((input, key) => {
    if (input === "?" || key.escape) onClose();
  });
  return (
    <Box marginTop={1}>
      <HelpOverlay
        groups={[
          {
            title: "Global",
            keys: [
              { key: "1 / 2 / 3", desc: "Switch tabs" },
              { key: "tab", desc: "Cycle tabs" },
              { key: ":", desc: "Command palette" },
              { key: "?", desc: "Toggle help" },
              { key: "r", desc: "Refresh data" },
              { key: "q", desc: "Quit" },
            ],
          },
          {
            title: "Claims",
            keys: [
              { key: "j / ↓", desc: "Next row" },
              { key: "k / ↑", desc: "Prev row" },
              { key: "g / G", desc: "Top / Bottom" },
              { key: "PgUp/PgDn", desc: "Jump 10" },
              { key: "tab", desc: "List ↔ detail" },
              { key: "enter / l", desc: "Open detail" },
              { key: "esc / h", desc: "Back to list" },
            ],
          },
          {
            title: "New Claim",
            keys: [
              { key: "drag&drop", desc: "Drop file(s)" },
              { key: "tab", desc: "Cycle panel" },
              { key: "↑/↓", desc: "Move in list/form" },
              { key: "←/→", desc: "Cycle select / benef" },
              { key: "enter", desc: "Add / edit / save" },
              { key: "t / b / d", desc: "Set kind" },
              { key: "x", desc: "Remove file" },
              { key: "p", desc: "Preview dry-run" },
              { key: "esc", desc: "Cancel / back" },
            ],
          },
        ]}
      />
    </Box>
  );
}
