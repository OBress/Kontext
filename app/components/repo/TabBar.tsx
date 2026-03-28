"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  MessageSquare,
  Network,
  Wand2,
  Server,
  Users,
} from "lucide-react";

const tabs = [
  { icon: LayoutDashboard, label: "Overview", segment: "" },
  { icon: MessageSquare, label: "Chat", segment: "chat" },
  { icon: Network, label: "Architecture", segment: "graph" },
  { icon: Wand2, label: "Prompts", segment: "prompts" },
  { icon: Server, label: "MCP Server", segment: "mcp" },
  { icon: Users, label: "Team", segment: "team" },
];

interface TabBarProps {
  basePath: string;
}

export function TabBar({ basePath }: TabBarProps) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 border-b border-[var(--alpha-white-5)] overflow-x-auto no-scrollbar">
      {tabs.map((tab) => {
        const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
        const isActive =
          tab.segment === ""
            ? pathname === basePath
            : pathname === href || pathname.startsWith(href + "/");

        return (
          <Link
            key={tab.segment}
            href={href}
            className={`
              relative flex items-center gap-2 px-4 py-3 text-sm font-mono whitespace-nowrap transition-colors no-underline
              ${isActive ? "text-[var(--accent-cyan)]" : "text-[var(--gray-500)] hover:text-[var(--gray-300)]"}
            `}
          >
            <tab.icon size={15} />
            <span>{tab.label}</span>
            {isActive && (
              <motion.div
                layoutId="tab-underline"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent-cyan)]"
                transition={{ duration: 0.2 }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
