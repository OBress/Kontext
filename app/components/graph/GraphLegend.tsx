"use client";

const fileTypeColors: Record<string, { color: string; label: string }> = {
  ts: { color: "#3FB950", label: "TypeScript" },
  js: { color: "#FFD600", label: "JavaScript" },
  css: { color: "#FF4081", label: "CSS/SCSS" },
  json: { color: "#3FB950", label: "JSON/YAML" },
  md: { color: "#9E9E9E", label: "Markdown" },
  config: { color: "#FFB300", label: "Config" },
  other: { color: "#FFFFFF", label: "Other" },
};

export function GraphLegend() {
  return (
    <div className="absolute bottom-4 left-4 z-20">
      <div className="glass-strong rounded-xl px-4 py-3">
        <span className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] block mb-2">
          Legend
        </span>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {Object.entries(fileTypeColors).map(([, { color, label }]) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}40` }}
              />
              <span className="font-mono text-xs text-[var(--gray-400)]">
                {label}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-[var(--alpha-white-5)]">
          <span className="font-mono text-xs text-[var(--gray-500)]">
            Node size = file line count
          </span>
        </div>
      </div>
    </div>
  );
}
