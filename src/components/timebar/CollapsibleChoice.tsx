import { useState } from "react";
import { Button } from "@/components/ui/button";

type Option<T> = { value: T; label: string };

// 收合時只顯示一顆「標題 + 目前值」按鈕；點開後展開成選項列，選完自動收回。
// 倍速（Speed）與時間窗口（Time window）共用。
export function CollapsibleChoice<T extends string | number>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Option<T>[];
  // 目前值；null 代表不屬於任何預設選項（例如拖曳把手調出來的自訂寬度）
  value: T | null;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 px-3 bg-[#1e1e24] border border-slate-700 rounded-lg text-xs font-mono text-slate-300 hover:text-white hover:bg-slate-700"
      >
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mr-2">
          {title}
        </span>
        {current?.label ?? "Custom"}
      </Button>
    );
  }

  return (
    <div className="flex items-center bg-[#1e1e24] border border-slate-700 rounded-lg p-1 gap-1">
      <span className="text-[11px] font-bold text-slate-500 px-2 uppercase tracking-widest">
        {title}
      </span>
      {options.map((o) => (
        <Button
          key={o.value}
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(o.value);
            setOpen(false);
          }}
          className={`h-6 px-2 text-xs font-mono rounded-md transition-all ${
            o.value === value
              ? "bg-cyan-500 text-slate-900 hover:bg-cyan-400 hover:text-slate-900 shadow-sm"
              : "text-slate-400 hover:text-white hover:bg-slate-700"
          }`}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
