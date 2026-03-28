"use client";

import { useState } from "react";
import { GlowCard } from "@/app/components/shared/GlowCard";
import { PulseOrb } from "@/app/components/shared/PulseOrb";
import { Users, UserPlus, Mail, ChevronRight, ChevronLeft, Check, Shield, Eye, Edit, Crown, X, Send, PartyPopper, type LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const mockMembers = [
  { id: 1, name: "Owen Bress", username: "obress", avatar: "", role: "Owner" as const, online: true, joinedAt: "2026-03-01" },
  { id: 2, name: "Sarah Chen", username: "schen", avatar: "", role: "Admin" as const, online: true, joinedAt: "2026-03-05" },
  { id: 3, name: "Alex Kim", username: "akim", avatar: "", role: "Member" as const, online: false, joinedAt: "2026-03-12" },
  { id: 4, name: "Jordan Lee", username: "jlee", avatar: "", role: "Member" as const, online: true, joinedAt: "2026-03-18" },
  { id: 5, name: "Morgan Davis", username: "mdavis", avatar: "", role: "Viewer" as const, online: false, joinedAt: "2026-03-25" },
];

const roleColors: Record<string, string> = { Owner: "var(--accent-amber)", Admin: "var(--accent-purple)", Member: "var(--accent-cyan)", Viewer: "var(--gray-500)" };
const roleIcons: Record<string, LucideIcon> = { Owner: Crown, Admin: Shield, Member: Edit, Viewer: Eye };

const onboardingSteps = [
  { title: "Welcome", description: "Repository overview and team introduction" },
  { title: "Architecture", description: "Explore the codebase structure in 3D" },
  { title: "Key Files", description: "Important files and their purposes" },
  { title: "Conventions", description: "Coding standards and patterns" },
  { title: "Setup", description: "Getting started with development" },
];

export default function TeamPage() {
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("Member");
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardComplete, setWizardComplete] = useState(false);

  const handleInvite = () => {
    if (!inviteUsername.trim()) return;
    setInviteUsername("");
  };

  return (
    <div className="space-y-6">
      {/* Team Roster */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--gray-500)] m-0">Team Members ({mockMembers.length})</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {mockMembers.map((member) => {
            const RoleIcon = roleIcons[member.role];
            return (
              <GlowCard key={member.id} glowColor="none" className="p-4">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-[var(--surface-3)] flex items-center justify-center font-mono text-sm text-[var(--gray-300)]">
                      {member.name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    {member.online && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--accent-green)] border-2 border-[var(--surface-2)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-[var(--gray-100)] m-0">{member.name}</p>
                    <p className="font-mono text-xs text-[var(--gray-500)] m-0">@{member.username}</p>
                  </div>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono" style={{ color: roleColors[member.role], backgroundColor: `${roleColors[member.role]}15` }}>
                    <RoleIcon size={10} /> {member.role}
                  </span>
                </div>
              </GlowCard>
            );
          })}
        </div>
      </div>

      {/* Invite */}
      <GlowCard glowColor="cyan" className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={16} className="text-[var(--accent-cyan)]" />
          <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">Invite Team Member</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input value={inviteUsername} onChange={(e) => setInviteUsername(e.target.value)} placeholder="GitHub username" className="flex-1 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-cyan)]/40" />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] focus:outline-none cursor-pointer">
            <option value="Viewer">Viewer</option>
            <option value="Member">Member</option>
            <option value="Admin">Admin</option>
          </select>
          <button onClick={handleInvite} disabled={!inviteUsername.trim()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono bg-[var(--accent-cyan)] text-black font-medium hover:opacity-90 disabled:opacity-40 border-none cursor-pointer">
            <Send size={14} /> Send Invite
          </button>
        </div>
      </GlowCard>

      {/* Onboarding Preview */}
      <GlowCard glowColor="purple" className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[var(--accent-purple)]" />
            <h3 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0">Onboarding Wizard</h3>
          </div>
          <button onClick={() => { setShowWizard(!showWizard); setWizardStep(0); setWizardComplete(false); }} className="px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--accent-purple)]/10 text-[var(--accent-purple)] border border-[var(--accent-purple)]/20 hover:bg-[var(--accent-purple)]/20 cursor-pointer">
            {showWizard ? "Close Preview" : "Preview Wizard"}
          </button>
        </div>

        {!showWizard && (
          <div className="grid grid-cols-5 gap-2">
            {onboardingSteps.map((step, i) => (
              <div key={i} className="text-center p-3 rounded-lg bg-[var(--alpha-white-5)]">
                <span className="font-mono text-lg text-[var(--accent-purple)]">{i + 1}</span>
                <p className="font-mono text-[11px] text-[var(--gray-300)] m-0 mt-1">{step.title}</p>
              </div>
            ))}
          </div>
        )}

        <AnimatePresence mode="wait">
          {showWizard && !wizardComplete && (
            <motion.div key={wizardStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="mt-4">
              {/* Progress bar */}
              <div className="flex gap-1.5 mb-6">
                {onboardingSteps.map((_, i) => (
                  <div key={i} className="flex-1 h-1 rounded-full overflow-hidden bg-[var(--alpha-white-8)]">
                    <div className="h-full rounded-full transition-all duration-300 bg-[var(--accent-purple)]" style={{ width: i <= wizardStep ? "100%" : "0%" }} />
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-[var(--alpha-white-5)] bg-[var(--surface-1)] p-6 min-h-[200px]">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent-purple)]">Step {wizardStep + 1} of {onboardingSteps.length}</span>
                <h4 className="font-mono text-lg text-[var(--gray-100)] mt-2 mb-2 m-0">{onboardingSteps[wizardStep].title}</h4>
                <p className="font-mono text-sm text-[var(--gray-400)] m-0">{onboardingSteps[wizardStep].description}</p>
                <div className="mt-4 p-4 rounded-lg bg-[var(--alpha-white-5)] font-mono text-xs text-[var(--gray-500)]">
                  [Content for this step would be AI-generated based on the repository analysis]
                </div>
              </div>

              <div className="flex justify-between mt-4">
                <button onClick={() => setWizardStep(Math.max(0, wizardStep - 1))} disabled={wizardStep === 0} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--alpha-white-5)] text-[var(--gray-400)] disabled:opacity-30 border-none cursor-pointer">
                  <ChevronLeft size={14} /> Back
                </button>
                <button onClick={() => { if (wizardStep < onboardingSteps.length - 1) setWizardStep(wizardStep + 1); else setWizardComplete(true); }} className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-xs font-mono bg-[var(--accent-purple)] text-white border-none cursor-pointer hover:opacity-90">
                  {wizardStep < onboardingSteps.length - 1 ? <>Next <ChevronRight size={14} /></> : <>Complete <Check size={14} /></>}
                </button>
              </div>
            </motion.div>
          )}
          {wizardComplete && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 text-center py-8">
              <PartyPopper size={40} className="text-[var(--accent-amber)] mx-auto mb-3" />
              <h4 className="font-mono text-lg text-[var(--gray-100)] m-0">You&apos;re all set!</h4>
              <p className="font-mono text-sm text-[var(--gray-500)] mt-2 m-0">Onboarding complete. Ready to contribute.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </GlowCard>
    </div>
  );
}
