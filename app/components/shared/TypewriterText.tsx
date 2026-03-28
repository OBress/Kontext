"use client";

import { useState, useEffect, useRef } from "react";

interface TypewriterTextProps {
  text: string;
  charsPerTick?: number;
  tickInterval?: number;
  onComplete?: () => void;
  className?: string;
  showCursor?: boolean;
}

export function TypewriterText({
  text,
  charsPerTick = 2,
  tickInterval = 20,
  onComplete,
  className = "",
  showCursor = true,
}: TypewriterTextProps) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const completedRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayedLength(0);
    completedRef.current = false;
  }, [text]);

  useEffect(() => {
    if (displayedLength >= text.length) {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }

    const timer = setTimeout(() => {
      setDisplayedLength((prev) => Math.min(prev + charsPerTick, text.length));
    }, tickInterval);

    return () => clearTimeout(timer);
  }, [displayedLength, text, charsPerTick, tickInterval, onComplete]);

  const isComplete = displayedLength >= text.length;

  return (
    <span className={className}>
      {text.slice(0, displayedLength)}
      {showCursor && !isComplete && (
        <span className="inline-block w-[2px] h-[1em] bg-[var(--accent-green)] ml-0.5 align-middle animate-blink" />
      )}
    </span>
  );
}
