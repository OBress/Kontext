"use client";

import { ReactNode } from "react";

interface GlowCardProps {
  children: ReactNode;
  glowColor?: "cyan" | "purple" | "green" | "amber" | "none";
  className?: string;
  onClick?: () => void;
}

const glowMap = {
  cyan: "hover:shadow-[0_0_20px_rgba(0,229,255,0.12),0_0_60px_rgba(0,229,255,0.04)] hover:border-[rgba(0,229,255,0.2)]",
  purple: "hover:shadow-[0_0_20px_rgba(124,77,255,0.12),0_0_60px_rgba(124,77,255,0.04)] hover:border-[rgba(124,77,255,0.2)]",
  green: "hover:shadow-[0_0_20px_rgba(0,230,118,0.12)] hover:border-[rgba(0,230,118,0.2)]",
  amber: "hover:shadow-[0_0_20px_rgba(255,179,0,0.12)] hover:border-[rgba(255,179,0,0.2)]",
  none: "",
};

export function GlowCard({
  children,
  glowColor = "cyan",
  className = "",
  onClick,
}: GlowCardProps) {
  return (
    <div
      onClick={onClick}
      className={`
        rounded-lg
        bg-[rgba(17,17,24,0.7)]
        backdrop-blur-xl
        border border-[rgba(255,255,255,0.06)]
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
