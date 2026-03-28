"use client";

interface PulseOrbProps {
  color?: "cyan" | "green" | "amber" | "red";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const colorMap = {
  cyan: { bg: "bg-[#00E5FF]", ring: "rgba(0,229,255,0.4)" },
  green: { bg: "bg-[#00E676]", ring: "rgba(0,230,118,0.4)" },
  amber: { bg: "bg-[#FFB300]", ring: "rgba(255,179,0,0.4)" },
  red: { bg: "bg-[#FF5252]", ring: "rgba(255,82,82,0.4)" },
};

const sizeMap = {
  sm: { dot: "w-2 h-2", ring: "w-4 h-4" },
  md: { dot: "w-3 h-3", ring: "w-6 h-6" },
  lg: { dot: "w-4 h-4", ring: "w-8 h-8" },
};

export function PulseOrb({
  color = "cyan",
  size = "sm",
  className = "",
}: PulseOrbProps) {
  const c = colorMap[color];
  const s = sizeMap[size];

  return (
    <span className={`relative inline-flex items-center justify-center ${s.ring} ${className}`}>
      <span
        className={`absolute ${s.ring} rounded-full animate-ping opacity-30`}
        style={{ backgroundColor: c.ring }}
      />
      <span className={`relative ${s.dot} rounded-full ${c.bg}`} />
    </span>
  );
}
