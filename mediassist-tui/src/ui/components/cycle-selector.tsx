import { Box, Text } from "ink";

type Props<T> = {
  items: T[];
  selectedIndex: number;
  isFocused: boolean;
  label?: string;
  /** How to render each item as a single line. */
  render: (item: T) => string;
};

/**
 * Single-line carousel widget. The currently-selected item is shown with
 * left/right chevrons; when focused, the parent's keyboard handler should
 * decrement/increment `selectedIndex` on ←/→.
 */
export function CycleSelector<T>({
  items,
  selectedIndex,
  isFocused,
  label,
  render,
}: Props<T>): JSX.Element {
  if (items.length === 0) {
    return (
      <Box>
        <Text dimColor>(no items)</Text>
      </Box>
    );
  }
  const safeIdx = Math.max(0, Math.min(selectedIndex, items.length - 1));
  const item = items[safeIdx]!;
  return (
    <Box>
      {label ? (
        <Box marginRight={1}>
          <Text bold dimColor>{label}</Text>
        </Box>
      ) : null}
      <Text color={isFocused ? "cyan" : "gray"} bold>{"◀ "}</Text>
      <Text inverse={isFocused} bold>
        {" "}{render(item)}{" "}
      </Text>
      <Text color={isFocused ? "cyan" : "gray"} bold>{" ▶"}</Text>
      <Text dimColor>   ({safeIdx + 1}/{items.length})</Text>
    </Box>
  );
}
