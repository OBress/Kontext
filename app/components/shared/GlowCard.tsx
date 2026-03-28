"use client";

import { ReactNode } from "react";

interface GlowCardProps {
  children: ReactNode;
  glowColor?: "cyan" | "green" | "purple" | "amber" | "none";
  className?: string;
  onClick?: () => void;
}

const glowMap = {
  cyan: "hover:shadow-[0_0_20px_rgba(63,185,80,0.12),0_0_60px_rgba(63,185,80,0.04)] hover:border-[rgba(63,185,80,0.2)]",
  green: "hover:shadow-[0_0_20px_rgba(63,185,80,0.12),0_0_60px_rgba(63,185,80,0.04)] hover:border-[rgba(63,185,80,0.2)]",
  purple: "hover:shadow-[0_0_20px_rgba(139,148,158,0.12),0_0_60px_rgba(139,148,158,0.04)] hover:border-[rgba(139,148,158,0.2)]",
  amber: "hover:shadow-[0_0_20px_rgba(210,153,34,0.12)] hover:border-[rgba(210,153,34,0.2)]",
  none: "",
};

export function GlowCard({
  children,
  glowColor = "green",
  className = "",
  onClick,
}: GlowCardProps) {
  return (
    <div
      onClick={onClick}
      className={`
        rounded-lg
        bg-[rgba(13,17,23,0.7)]
        backdrop-blur-xl
        border border-[#30363D]
        transition-all duration-300 ease-out
        ${glowMap[glowColor]}
        ${onClick ? "cursor-pointer" : ""}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
