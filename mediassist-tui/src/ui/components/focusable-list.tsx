import { Box, Text } from "ink";
import { useEffect, useState } from "react";

export type Column<T> = {
  header: string;
  /** Width in characters; if omitted, takes remaining space (single column allowed). */
  width?: number;
  align?: "left" | "right";
  render: (row: T) => string;
  color?: (row: T) => string | undefined;
};

type FocusableListProps<T> = {
  rows: T[];
  columns: Column<T>[];
  selectedIndex: number;
  /** Maximum rows to render; the list scrolls when there are more. */
  viewportHeight?: number;
  /** Optional non-data row for empty state. */
  emptyText?: string;
};

/**
 * A simple keyboard-navigable list. The parent owns `selectedIndex` so it
 * can scope keybindings to a focused panel. The list handles its own
 * scrolling window internally.
 */
export function FocusableList<T>({
  rows,
  columns,
  selectedIndex,
  viewportHeight = 10,
  emptyText = "(no rows)",
}: FocusableListProps<T>): JSX.Element {
  const [scrollTop, setScrollTop] = useState(0);

  // Keep the selected row inside the visible window.
  useEffect(() => {
    if (selectedIndex < scrollTop) setScrollTop(selectedIndex);
    else if (selectedIndex >= scrollTop + viewportHeight)
      setScrollTop(selectedIndex - viewportHeight + 1);
  }, [selectedIndex, scrollTop, viewportHeight]);

  if (rows.length === 0) {
    return <Text dimColor>{emptyText}</Text>;
  }

  const visible = rows.slice(scrollTop, scrollTop + viewportHeight);

  return (
    <Box flexDirection="column">
      {/* header */}
      <Box>
        {columns.map((c, idx) => (
          <Text key={idx} dimColor bold>
            {formatCell(c.header, c)}
            {idx < columns.length - 1 ? "  " : ""}
          </Text>
        ))}
      </Box>
      {/* rows */}
      {visible.map((row, idx) => {
        const absoluteIdx = scrollTop + idx;
        const selected = absoluteIdx === selectedIndex;
        return (
          <Box key={absoluteIdx}>
            {columns.map((c, ci) => (
              <Text
                key={ci}
                inverse={selected}
                color={!selected ? c.color?.(row) : undefined}
              >
                {formatCell(c.render(row), c)}
                {ci < columns.length - 1 ? "  " : ""}
              </Text>
            ))}
          </Box>
        );
      })}
      {/* scroll indicator */}
      {rows.length > viewportHeight ? (
        <Text dimColor>
          {scrollTop + 1}-{Math.min(scrollTop + viewportHeight, rows.length)} of {rows.length}
        </Text>
      ) : null}
    </Box>
  );
}

function formatCell<T>(text: string, col: Column<T>): string {
  if (!col.width) return text;
  if (text.length > col.width) return text.slice(0, col.width - 1) + "…";
  if (col.align === "right") return text.padStart(col.width, " ");
  return text.padEnd(col.width, " ");
}
