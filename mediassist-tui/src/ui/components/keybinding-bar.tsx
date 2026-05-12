import { Box, Text } from "ink";

export type KeyHint = { key: string; label: string };

type Props = {
  contextHints: KeyHint[];
  showGlobal?: boolean;
};

const GLOBAL: KeyHint[] = [
  { key: "1-3", label: "tabs" },
  { key: ":", label: "cmd" },
  { key: "r", label: "refresh" },
  { key: "?", label: "help" },
  { key: "q", label: "quit" },
];

/**
 * Context-sensitive footer inspired by lazygit. The keys shown depend on
 * which panel currently owns focus — callers pass them in `contextHints`.
 * Global keys (tab jumps, help, quit) are appended after a separator.
 */
export function KeybindingBar({ contextHints, showGlobal = true }: Props): JSX.Element {
  return (
    <Box paddingX={1}>
      {contextHints.map((h, i) => (
        <Box key={`ctx-${i}`} marginRight={2}>
          <Text color="cyan" bold>
            [{h.key}]
          </Text>
          <Text dimColor> {h.label}</Text>
        </Box>
      ))}
      {showGlobal ? (
        <>
          {contextHints.length > 0 ? <Text dimColor>·  </Text> : null}
          {GLOBAL.map((h, i) => (
            <Box key={`g-${i}`} marginRight={2}>
              <Text color="gray" bold>
                [{h.key}]
              </Text>
              <Text dimColor> {h.label}</Text>
            </Box>
          ))}
        </>
      ) : null}
    </Box>
  );
}
