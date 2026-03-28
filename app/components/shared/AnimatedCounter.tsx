"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  format?: "integer" | "decimal" | "compact";
  className?: string;
}

function formatValue(n: number, format: string): string {
  if (format === "compact") {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  }
  if (format === "decimal") return n.toFixed(1);
  return n.toLocaleString();
}

export function AnimatedCounter({
  value,
  duration = 600,
  format = "integer",
  className = "",
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const startRef = useRef(displayValue);
  const frameRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);

  const animate = useCallback(
    (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      const current =
        startRef.current + (value - startRef.current) * eased;
      setDisplayValue(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    },
    [value, duration]
  );

  useEffect(() => {
    startRef.current = displayValue;
    startTimeRef.current = undefined;
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className={`tabular-nums ${className}`}>
      {formatValue(Math.round(displayValue), format)}
    </span>
  );
}
