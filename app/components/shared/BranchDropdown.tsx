"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, ChevronDown, Loader2, Check } from "lucide-react";

interface BranchDropdownProps {
  value: string;
  onChange: (branch: string) => void;
  branches: string[];
  loading?: boolean;
}

export function BranchDropdown({
  value,
  onChange,
  branches,
  loading,
}: BranchDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--surface-1)] px-3 py-2.5 cursor-pointer transition-colors hover:border-[var(--alpha-white-15)]"
        style={{ borderColor: open ? "var(--accent-green)40" : undefined }}
      >
        <GitBranch size={14} className="text-[var(--accent-green)] shrink-0" />
        <span className="flex-1 text-left text-sm font-mono text-[var(--gray-200)] truncate">
          {value}
        </span>
        {loading ? (
          <Loader2 size={12} className="text-[var(--gray-500)] animate-spin shrink-0" />
        ) : (
          <ChevronDown
            size={12}
            className={`text-[var(--gray-500)] shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && branches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-[var(--alpha-white-10)] bg-[var(--surface-2)] shadow-xl shadow-black/40 overflow-hidden max-h-[160px] overflow-y-auto"
          >
            {branches.map((branch) => (
              <button
                key={branch}
                onClick={() => {
                  onChange(branch);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-mono transition-colors cursor-pointer border-none ${
                  branch === value
                    ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)]"
                    : "bg-transparent text-[var(--gray-300)] hover:bg-[var(--alpha-white-5)] hover:text-[var(--gray-100)]"
                }`}
              >
                {branch === value ? (
                  <Check size={12} className="text-[var(--accent-green)] shrink-0" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                {branch}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
