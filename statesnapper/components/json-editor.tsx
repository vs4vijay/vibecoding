"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export function JsonEditor({
  value,
  onChange,
  height = 360,
}: {
  value: string;
  onChange: (v: string) => void;
  height?: number;
}) {
  const options = useMemo(
    () => ({
      minimap: { enabled: false },
      fontSize: 13,
      tabSize: 2,
      formatOnPaste: true,
      scrollBeyondLastLine: false,
      automaticLayout: true,
    }),
    []
  );
  return (
    <Monaco
      height={height}
      language="json"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      options={options}
    />
  );
}
