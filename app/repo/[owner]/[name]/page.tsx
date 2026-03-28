"use client";

import { useParams } from "next/navigation";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { AnimatedCounter } from "@/app/components/shared/AnimatedCounter";
import { PulseOrb } from "@/app/components/shared/PulseOrb";
import {
  Database,
  MessageSquare,
  Network,
  Wand2,
  Server,
  Users,
  FileCode,
  GitBranch,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

export default function RepoOverviewPage() {
  const params = useParams<{ owner: string; name: string }>();
  const basePath = `/repo/${params.owner}/${params.name}`;

  return (
    <div className="space-y-6">
      {/* Bento grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Ingestion Status */}
        <GlowCard glowColor="green" className="p-5 md:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <Database size={16} className="text-[var(--accent-green)]" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
              Ingestion Status
            </h3>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--alpha-white-5)" strokeWidth="2" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent-green)" strokeWidth="2"
                  strokeDasharray="97.4" strokeDashoffset="0" strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-mono text-xs text-[var(--accent-green)]">
                100%
              </span>
            </div>
            <div className="space-y-1">
              <p className="font-mono text-xs text-[var(--gray-400)] m-0">
                <span className="text-[var(--gray-200)]"><AnimatedCounter value={147} /></span> files indexed
              </p>
              <p className="font-mono text-xs text-[var(--gray-400)] m-0">
                <span className="text-[var(--gray-200)]"><AnimatedCounter value={1847} /></span> chunks embedded
              </p>
              <p className="font-mono text-xs text-[var(--gray-400)] m-0">
                768-dim vectors
              </p>
            </div>
          </div>
        </GlowCard>

        {/* Quick links */}
        <QuickLink
          href={`${basePath}/chat`}
          icon={MessageSquare}
          label="Chat"
          description="Ask questions about this codebase"
          color="var(--accent-cyan)"
        />
        <QuickLink
          href={`${basePath}/graph`}
          icon={Network}
          label="Architecture"
          description="3D dependency visualization"
          color="var(--accent-purple)"
        />
        <QuickLink
          href={`${basePath}/prompts`}
          icon={Wand2}
          label="Prompts"
          description="Generate AI system prompts"
          color="var(--accent-amber)"
        />
        <QuickLink
          href={`${basePath}/mcp`}
          icon={Server}
          label="MCP Server"
          description="Model Context Protocol endpoint"
          color="var(--accent-cyan)"
        />
        <QuickLink
          href={`${basePath}/team`}
          icon={Users}
          label="Team"
          description="Onboarding & access management"
          color="var(--accent-green)"
        />
      </div>

      {/* Tech stack */}
      <GlowCard glowColor="none" className="p-5">
        <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] mb-3 m-0">
          Detected Stack
        </h3>
        <div className="flex flex-wrap gap-2">
          {["Next.js 14", "TypeScript", "React 18", "Tailwind CSS", "Prisma", "PostgreSQL", "Docker", "Jest"].map(
            (tech) => (
              <span
                key={tech}
                className="px-2.5 py-1 rounded-full text-xs font-mono bg-[var(--alpha-white-5)] text-[var(--gray-300)] border border-[var(--alpha-white-8)]"
              >
                {tech}
              </span>
            )
          )}
        </div>
      </GlowCard>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  description,
  color,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  color: string;
}) {
  return (
    <Link href={href} className="no-underline">
      <GlowCard glowColor="cyan" className="p-5 h-full hover:translate-y-[-2px] transition-transform duration-200">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={16} style={{ color }} />
          <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">
            {label}
          </h3>
        </div>
        <p className="font-mono text-xs text-[var(--gray-500)] m-0 leading-relaxed">
          {description}
        </p>
      </GlowCard>
    </Link>
  );
}
