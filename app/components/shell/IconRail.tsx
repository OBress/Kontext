"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Server,
  Settings,
  LogOut,
  LogIn,
} from "lucide-react";
import { signOut } from "@/app/actions";

const navItems = [
  { icon: LayoutDashboard, label: "DASHBOARD", href: "/dashboard" },
  { icon: Server, label: "MCP SERVER", href: "/mcp" },
  { icon: Settings, label: "SETTINGS", href: "/settings" },
];

export function IconRail() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const pathname = usePathname();

  // Lightweight auth check
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => setIsAuthenticated(r.ok))
      .catch(() => setIsAuthenticated(false));
  }, []);

  return (
    <motion.nav
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      initial={false}
      animate={{ width: isExpanded ? 170 : 36 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="fixed left-0 top-1/2 -translate-y-1/2 z-50 flex flex-col py-1 rounded-r-xl overflow-hidden"
      style={{
        background: isExpanded
          ? "linear-gradient(135deg, rgba(10,10,12,0.94), rgba(18,18,22,0.9))"
          : "linear-gradient(135deg, rgba(10,10,12,0.6), rgba(18,18,22,0.5))",
        boxShadow: isExpanded
          ? "4px 0 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)"
          : "2px 0 8px rgba(0,0,0,0.2)",
        backdropFilter: "blur(16px)",
      }}
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={isAuthenticated === false ? "/login" : item.href}
            className={`
              relative flex items-center gap-2.5 h-8 px-2.5 transition-colors duration-150 no-underline
              ${isActive
                ? "text-[var(--accent-green)]"
                : "text-[var(--gray-400)] hover:text-[var(--gray-100)] hover:bg-[var(--alpha-white-5)]"
              }
            `}
          >
            {isActive && (
              <>
                <motion.div
                  layoutId="pill-active-bg"
                  className="absolute inset-0 bg-[var(--alpha-white-10)]"
                  transition={{ duration: 0.2 }}
                />
                <motion.div
                  layoutId="pill-active-bar"
                  className="absolute left-0 inset-y-0 w-[2px] bg-[var(--accent-green)]"
                  transition={{ duration: 0.2 }}
                />
              </>
            )}
            <item.icon size={15} className="relative shrink-0" />
            <motion.span
              animate={{ opacity: isExpanded ? 1 : 0 }}
              transition={{ duration: 0.15, delay: isExpanded ? 0.05 : 0 }}
              className="relative text-[13px] font-mono whitespace-nowrap overflow-hidden tracking-wide"
            >
              {item.label}
            </motion.span>
          </Link>
        );
      })}

      {/* Divider */}
      <div className="h-px bg-[var(--alpha-white-8)] mx-2 my-1" />

      {/* Sign in / Sign out */}
      {isAuthenticated === false ? (
        <Link
          href="/login"
          className="flex items-center gap-2.5 h-8 px-2.5 transition-colors duration-150 text-[var(--accent-green)] hover:bg-[var(--alpha-white-5)] no-underline"
        >
          <LogIn size={15} className="shrink-0" />
          <motion.span
            animate={{ opacity: isExpanded ? 1 : 0 }}
            transition={{ duration: 0.15, delay: isExpanded ? 0.05 : 0 }}
            className="text-[13px] font-mono whitespace-nowrap overflow-hidden tracking-wide"
          >
            SIGN IN
          </motion.span>
        </Link>
      ) : (
        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-2.5 h-8 px-2.5 transition-colors duration-150 text-[var(--gray-400)] hover:text-[var(--accent-red)] hover:bg-[var(--alpha-white-5)] bg-transparent border-none cursor-pointer"
          >
            <LogOut size={15} className="shrink-0" />
            <motion.span
              animate={{ opacity: isExpanded ? 1 : 0 }}
              transition={{ duration: 0.15, delay: isExpanded ? 0.05 : 0 }}
              className="text-[13px] font-mono whitespace-nowrap overflow-hidden tracking-wide"
            >
              SIGN OUT
            </motion.span>
          </button>
        </form>
      )}
    </motion.nav>
  );
}
