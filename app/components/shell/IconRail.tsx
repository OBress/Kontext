"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  MessageSquare,
  Network,
  Wand2,
  Server,
  Users,
  Settings,
  LogOut,
} from "lucide-react";
import { signOut } from "@/app/actions";

const mainNavItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/", alwaysEnabled: true },
];

const repoNavItems = [
  { icon: MessageSquare, label: "Chat", segment: "chat" },
  { icon: Network, label: "Architecture", segment: "graph" },
  { icon: Wand2, label: "Prompts", segment: "prompts" },
  { icon: Server, label: "MCP Server", segment: "mcp" },
  { icon: Users, label: "Team", segment: "team" },
];

const bottomNavItems = [
  { icon: Settings, label: "Settings", href: "/settings", alwaysEnabled: true },
];

export function IconRail() {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();
  const activeRepo = useAppStore((s) => s.activeRepo);

  const repoBase = activeRepo
    ? `/repo/${activeRepo.owner}/${activeRepo.name}`
    : null;

  return (
    <motion.nav
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      animate={{ width: isExpanded ? 220 : 56 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="fixed left-0 top-12 bottom-0 z-40 flex flex-col border-r border-[var(--alpha-white-5)] bg-[var(--surface-0)]"
    >
      {/* Main nav */}
      <div className="flex-1 flex flex-col gap-1 pt-4 px-2">
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                relative flex items-center gap-3 h-10 rounded-lg px-3 transition-colors duration-150 no-underline
                ${isActive
                  ? "bg-[var(--alpha-white-8)] text-[var(--accent-green)]"
                  : "text-[var(--gray-400)] hover:text-[var(--gray-200)] hover:bg-[var(--alpha-white-5)]"
                }
              `}
            >
              {isActive && (
                <motion.div
                  layoutId="rail-active"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[var(--accent-green)] rounded-full"
                  transition={{ duration: 0.2 }}
                />
              )}
              <item.icon size={18} className="shrink-0" />
              <motion.span
                animate={{ opacity: isExpanded ? 1 : 0 }}
                transition={{ duration: 0.15, delay: isExpanded ? 0.05 : 0 }}
                className="text-sm font-mono whitespace-nowrap overflow-hidden"
              >
                {item.label}
              </motion.span>
            </Link>
          );
        })}

        {/* Divider */}
        <div className="h-px bg-[var(--alpha-white-5)] mx-2 my-2" />

        {/* Repo nav items */}
        {repoNavItems.map((item) => {
          const href = repoBase ? `${repoBase}/${item.segment}` : "#";
          const isActive = pathname === href;
          const isDisabled = !activeRepo;

          return (
            <Link
              key={item.segment}
              href={isDisabled ? "#" : href}
              onClick={(e) => isDisabled && e.preventDefault()}
              className={`
                relative flex items-center gap-3 h-10 rounded-lg px-3 transition-colors duration-150 no-underline
                ${isDisabled
                  ? "text-[var(--gray-700)] cursor-not-allowed"
                  : isActive
                    ? "bg-[var(--alpha-white-8)] text-[var(--accent-green)]"
                    : "text-[var(--gray-400)] hover:text-[var(--gray-200)] hover:bg-[var(--alpha-white-5)]"
                }
              `}
            >
              {isActive && !isDisabled && (
                <motion.div
                  layoutId="rail-active"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[var(--accent-green)] rounded-full"
                  transition={{ duration: 0.2 }}
                />
              )}
              <item.icon size={18} className="shrink-0" />
              <motion.span
                animate={{ opacity: isExpanded ? 1 : 0 }}
                transition={{ duration: 0.15, delay: isExpanded ? 0.05 : 0 }}
                className="text-sm font-mono whitespace-nowrap overflow-hidden"
              >
                {item.label}
              </motion.span>
            </Link>
          );
        })}
      </div>

      {/* Bottom nav */}
      <div className="flex flex-col gap-1 pb-4 px-2">
        {bottomNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 h-10 rounded-lg px-3 transition-colors duration-150 no-underline
                ${isActive
                  ? "bg-[var(--alpha-white-8)] text-[var(--accent-green)]"
                  : "text-[var(--gray-400)] hover:text-[var(--gray-200)] hover:bg-[var(--alpha-white-5)]"
                }
              `}
            >
              <item.icon size={18} className="shrink-0" />
              <motion.span
                animate={{ opacity: isExpanded ? 1 : 0 }}
                transition={{ duration: 0.15, delay: isExpanded ? 0.05 : 0 }}
                className="text-sm font-mono whitespace-nowrap overflow-hidden"
              >
                {item.label}
              </motion.span>
            </Link>
          );
        })}

        {/* Sign out */}
        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 h-10 rounded-lg px-3 transition-colors duration-150 text-[var(--gray-400)] hover:text-[var(--accent-red)] hover:bg-[var(--alpha-white-5)] bg-transparent border-none cursor-pointer"
          >
            <LogOut size={18} className="shrink-0" />
            <motion.span
              animate={{ opacity: isExpanded ? 1 : 0 }}
              transition={{ duration: 0.15, delay: isExpanded ? 0.05 : 0 }}
              className="text-sm font-mono whitespace-nowrap overflow-hidden"
            >
              Sign Out
            </motion.span>
          </button>
        </form>
      </div>
    </motion.nav>
  );
}
