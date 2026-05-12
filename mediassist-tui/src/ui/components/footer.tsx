import { Box, Text } from "ink";

export type KeyHint = { key: string; label: string };

type FooterProps = {
  hints: KeyHint[];
};

/**
 * Context-aware keybinding footer (one per screen). Keys are colored, labels
 * dim — the standard lazygit / k9s pattern.
 */
export function Footer({ hints }: FooterProps): JSX.Element {
  return (
    <Box marginTop={1}>
      {hints.map((h, idx) => (
        <Box key={h.key} marginRight={2}>
          <Text color="cyan" bold>
            [{h.key}]
          </Text>
          <Text dimColor> {h.label}</Text>
          {idx < hints.length - 1 ? <Text dimColor>   </Text> : null}
        </Box>
      ))}
    </Box>
  );
}
