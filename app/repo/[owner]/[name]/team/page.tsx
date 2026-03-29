"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { GlowCard } from "@/app/components/shared/GlowCard";
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  Crown,
  Edit,
  Eye,
  Loader2,
  Plus,
  Send,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

interface TeamMember {
  id: number;
  user_id: string;
  role: string;
  joined_at: string;
}

interface TeamInvite {
  id: number;
  github_username: string;
  role: string;
  created_at: string | null;
  onboarding_template_version_id?: number | null;
}

interface OnboardingStep {
  stepType: "content" | "guided_explore" | "quiz" | "acknowledgement";
  title: string;
  description: string;
  content: string;
  quizPayload?: Record<string, unknown>;
}

interface OnboardingTemplate {
  id: number;
  title: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  currentVersion: number;
  activeVersionId: number | null;
  steps: OnboardingStep[];
}

interface OnboardingAssignment {
  id: number;
  status: string;
  progressPercent: number;
  assigneeGitHubUsername: string | null;
  templateTitle: string | null;
  templateVersionNumber: number | null;
}

interface AssignmentSummary {
  assigned: number;
  in_progress: number;
  completed: number;
  overdue: number;
  cancelled: number;
  total: number;
  completionRate: number;
}

const roleColors: Record<string, string> = {
  Owner: "var(--accent-yellow)",
  Admin: "var(--accent-green)",
  Member: "var(--accent-green)",
  Viewer: "var(--gray-500)",
};

const roleIcons: Record<string, LucideIcon> = {
  Owner: Crown,
  Admin: Shield,
  Member: Edit,
  Viewer: Eye,
};

function emptyStep(): OnboardingStep {
  return {
    stepType: "content",
    title: "",
    description: "",
    content: "",
    quizPayload: {},
  };
}

function fallbackTemplate(): OnboardingTemplate {
  return {
    id: 0,
    title: "Repository onboarding",
    description: "A guided walkthrough for teammates joining this repo.",
    status: "draft",
    currentVersion: 0,
    activeVersionId: null,
    steps: [emptyStep()],
  };
}

export default function TeamPage() {
  const params = useParams<{ owner: string; name: string }>();
  const repoFullName = `${params.owner}/${params.name}`;

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [draftTemplate, setDraftTemplate] = useState<OnboardingTemplate>(
    fallbackTemplate()
  );
  const [activeTemplate, setActiveTemplate] = useState<OnboardingTemplate | null>(
    null
  );
  const [assignments, setAssignments] = useState<OnboardingAssignment[]>([]);
  const [assignmentSummary, setAssignmentSummary] = useState<AssignmentSummary>({
    assigned: 0,
    in_progress: 0,
    completed: 0,
    overdue: 0,
    cancelled: 0,
    total: 0,
    completionRate: 0,
  });
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [assignOnboarding, setAssignOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManage = callerRole === "owner" || callerRole === "admin";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const teamRes = await fetch(`/api/team?repo=${encodeURIComponent(repoFullName)}`);
      if (!teamRes.ok) throw new Error("Failed to load team data.");
      const teamData = await teamRes.json();
      setMembers(teamData.members || []);
      setInvites(teamData.invites || []);
      setCallerRole(teamData.callerRole || null);

      const templateRes = await fetch(
        `/api/repos/onboarding/templates?repo=${encodeURIComponent(repoFullName)}`
      );
      if (templateRes.ok) {
        const templateData = await templateRes.json();
        setActiveTemplate((templateData.activeTemplate as OnboardingTemplate | null) || null);
        setDraftTemplate(
          (templateData.latestTemplate as OnboardingTemplate | null) || fallbackTemplate()
        );
      }

      const assignmentRes = await fetch(
        `/api/repos/onboarding/assignments?repo=${encodeURIComponent(repoFullName)}`
      );
      if (assignmentRes.ok) {
        const assignmentData = await assignmentRes.json();
        setAssignments((assignmentData.assignments || []) as OnboardingAssignment[]);
        setAssignmentSummary(
          (assignmentData.summary as AssignmentSummary) || {
            assigned: 0,
            in_progress: 0,
            completed: 0,
            overdue: 0,
            cancelled: 0,
            total: 0,
            completionRate: 0,
          }
        );
      }
    } finally {
      setLoading(false);
    }
  }, [repoFullName]);

  useEffect(() => {
    fetchData().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Failed to load team data.");
      setLoading(false);
    });
  }, [fetchData]);

  useEffect(() => {
    setAssignOnboarding(!!activeTemplate && inviteRole !== "admin");
  }, [activeTemplate, inviteRole]);

  const pendingAssignments = useMemo(
    () => assignments.filter((assignment) => !!assignment.assigneeGitHubUsername),
    [assignments]
  );

  const updateStep = (index: number, patch: Partial<OnboardingStep>) => {
    setDraftTemplate((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step
      ),
    }));
  };

  const persistTemplate = async (method: "POST" | "PATCH") => {
    const res = await fetch("/api/repos/onboarding/templates", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo_full_name: repoFullName,
        template_id: draftTemplate.id || undefined,
        title: draftTemplate.title,
        description: draftTemplate.description || "",
        steps: draftTemplate.steps,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || "Failed to save onboarding template.");
    }
    const template = data.template as OnboardingTemplate;
    setDraftTemplate(template);
    return template;
  };

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await action();
      await fetchData();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-[var(--gray-500)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
        <GlowCard glowColor="none" className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-sm text-[var(--gray-200)] m-0">
              Team Members ({members.length})
            </h3>
            {callerRole && (
              <span className="font-mono text-xs uppercase text-[var(--gray-500)]">
                You are {callerRole}
              </span>
            )}
          </div>

          {members.length === 0 ? (
            <p className="font-mono text-sm text-[var(--gray-500)] m-0">
              No team members yet. You will be added as owner when you index this repo.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {members.map((member) => {
                const displayRole =
                  member.role.charAt(0).toUpperCase() + member.role.slice(1);
                const RoleIcon = roleIcons[displayRole] || Eye;
                return (
                  <div
                    key={member.id}
                    className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--surface-3)] flex items-center justify-center font-mono text-sm text-[var(--gray-300)]">
                        {member.user_id.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm text-[var(--gray-100)] m-0">
                          {member.user_id.slice(0, 8)}...
                        </p>
                        <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                          Joined {new Date(member.joined_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono"
                        style={{
                          color: roleColors[displayRole] || "var(--gray-500)",
                          backgroundColor: `${roleColors[displayRole] || "var(--gray-500)"}15`,
                        }}
                      >
                        <RoleIcon size={10} /> {displayRole}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlowCard>

        <GlowCard glowColor="cyan" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={16} className="text-[var(--accent-green)]" />
            <h3 className="font-mono text-sm text-[var(--gray-200)] m-0">
              Invite Team Member
            </h3>
          </div>

          {canManage ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  value={inviteUsername}
                  onChange={(event) => setInviteUsername(event.target.value)}
                  placeholder="GitHub username"
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)]"
                />
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value)}
                  className="px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)]"
                >
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() =>
                    runAction("invite", async () => {
                      const res = await fetch("/api/team", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          repo_full_name: repoFullName,
                          github_username: inviteUsername.trim(),
                          role: inviteRole,
                          assign_onboarding: assignOnboarding,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        throw new Error(data.error?.message || "Failed to send invite.");
                      }
                      setInviteUsername("");
                      setMessage(
                        data.onboarding_assignment
                          ? "Invite sent and onboarding assigned."
                          : "Invite sent."
                      );
                    })
                  }
                  disabled={!inviteUsername.trim() || busy === "invite"}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono bg-[var(--accent-green)] text-black font-medium hover:opacity-90 disabled:opacity-40 border-none cursor-pointer"
                >
                  {busy === "invite" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Send Invite
                </button>
              </div>
              <label className="flex items-center gap-2 font-mono text-xs text-[var(--gray-400)]">
                <input
                  type="checkbox"
                  checked={assignOnboarding}
                  onChange={(event) => setAssignOnboarding(event.target.checked)}
                  disabled={!activeTemplate || inviteRole === "admin"}
                />
                Auto-assign onboarding
              </label>
            </div>
          ) : (
            <p className="font-mono text-xs text-[var(--gray-500)] m-0">
              Only owners and admins can invite teammates and manage onboarding.
            </p>
          )}

          <div className="mt-5 space-y-2">
            <div className="flex items-center gap-2">
              <ClipboardList size={14} className="text-[var(--gray-500)]" />
              <span className="font-mono text-xs uppercase text-[var(--gray-500)]">
                Pending Invites
              </span>
            </div>
            {invites.length === 0 ? (
              <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                No pending invites yet.
              </p>
            ) : (
              invites.map((invite) => (
                <div
                  key={invite.id}
                  className="rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-[var(--gray-200)] m-0">
                        @{invite.github_username}
                      </p>
                      <p className="font-mono text-xs text-[var(--gray-500)] m-0 mt-1">
                        {invite.role} invited{" "}
                        {invite.created_at
                          ? new Date(invite.created_at).toLocaleDateString()
                          : "recently"}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-[var(--gray-500)]">
                      {invite.onboarding_template_version_id
                        ? "Onboarding attached"
                        : "No onboarding"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </GlowCard>
      </div>

      <GlowCard glowColor="purple" className="p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--accent-green)]" />
              <h3 className="font-mono text-sm text-[var(--gray-200)] m-0">
                Onboarding Manager
              </h3>
            </div>
            <p className="font-mono text-xs text-[var(--gray-500)] m-0 mt-2">
              Generate, customize, publish, and track onboarding for this repo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                runAction("generate", async () => {
                  const res = await fetch("/api/repos/onboarding/templates/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ repo_full_name: repoFullName }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    throw new Error(data.error?.message || "Failed to generate onboarding.");
                  }
                  setDraftTemplate(data.template as OnboardingTemplate);
                  setMessage("Generated a fresh onboarding draft.");
                })
              }
              disabled={!canManage || busy === "generate"}
              className="px-3 py-2 rounded-lg text-xs font-mono bg-[var(--accent-green)] text-black font-medium disabled:opacity-40 border-none cursor-pointer"
            >
              {busy === "generate" ? "Generating..." : "Generate Draft"}
            </button>
            <button
              onClick={() =>
                runAction("duplicate", async () => {
                  const sourceId = activeTemplate?.id || draftTemplate.id;
                  if (!sourceId) throw new Error("Nothing to duplicate yet.");
                  const res = await fetch("/api/repos/onboarding/templates", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      repo_full_name: repoFullName,
                      action: "duplicate",
                      template_id: sourceId,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    throw new Error(data.error?.message || "Failed to duplicate onboarding.");
                  }
                  setDraftTemplate(data.template as OnboardingTemplate);
                  setMessage("Created a duplicate onboarding draft.");
                })
              }
              disabled={!canManage || busy === "duplicate"}
              className="px-3 py-2 rounded-lg text-xs font-mono bg-[var(--alpha-white-5)] border border-[var(--alpha-white-8)] text-[var(--gray-300)] disabled:opacity-40 cursor-pointer flex items-center gap-2"
            >
              <Copy size={12} /> Duplicate
            </button>
            <button
              onClick={() =>
                runAction("publish", async () => {
                  const savedTemplate = draftTemplate.id
                    ? draftTemplate
                    : await persistTemplate("POST");
                  const res = await fetch("/api/repos/onboarding/templates", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      repo_full_name: repoFullName,
                      template_id: savedTemplate.id,
                      action: "publish",
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    throw new Error(data.error?.message || "Failed to publish onboarding.");
                  }
                  setMessage("Published the onboarding template.");
                })
              }
              disabled={!canManage || busy === "publish"}
              className="px-3 py-2 rounded-lg text-xs font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20 disabled:opacity-40 cursor-pointer"
            >
              {busy === "publish" ? "Publishing..." : "Publish"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
          <StatCard label="Published" value={activeTemplate ? `v${activeTemplate.currentVersion}` : "None"} />
          <StatCard label="Assigned" value={String(assignmentSummary.assigned)} />
          <StatCard label="In Progress" value={String(assignmentSummary.in_progress)} />
          <StatCard label="Completed" value={`${assignmentSummary.completed} (${assignmentSummary.completionRate}%)`} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4">
              <input
                value={draftTemplate.title}
                onChange={(event) =>
                  setDraftTemplate((current) => ({ ...current, title: event.target.value }))
                }
                disabled={!canManage}
                placeholder="Template title"
                className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)]"
              />
              <textarea
                value={draftTemplate.description || ""}
                onChange={(event) =>
                  setDraftTemplate((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                disabled={!canManage}
                rows={3}
                placeholder="What does this onboarding cover?"
                className="mt-3 w-full px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)]"
              />
            </div>

            {draftTemplate.steps.map((step, index) => (
              <div
                key={`${step.title}-${index}`}
                className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[var(--gray-500)]">
                    Step {index + 1}
                  </span>
                  {canManage && (
                    <button
                      onClick={() =>
                        setDraftTemplate((current) => ({
                          ...current,
                          steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
                        }))
                      }
                      disabled={draftTemplate.steps.length <= 1}
                      className="p-1.5 rounded-lg bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20 cursor-pointer disabled:opacity-30"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <select
                  value={step.stepType}
                  disabled={!canManage}
                  onChange={(event) =>
                    updateStep(index, {
                      stepType: event.target.value as OnboardingStep["stepType"],
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)]"
                >
                  <option value="content">Content</option>
                  <option value="guided_explore">Guided Explore</option>
                  <option value="quiz">Quiz</option>
                  <option value="acknowledgement">Acknowledgement</option>
                </select>
                <input
                  value={step.title}
                  disabled={!canManage}
                  onChange={(event) => updateStep(index, { title: event.target.value })}
                  placeholder="Step title"
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)]"
                />
                <textarea
                  value={step.description}
                  disabled={!canManage}
                  onChange={(event) =>
                    updateStep(index, { description: event.target.value })
                  }
                  rows={2}
                  placeholder="Short description"
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)]"
                />
                <textarea
                  value={step.content}
                  disabled={!canManage}
                  onChange={(event) => updateStep(index, { content: event.target.value })}
                  rows={4}
                  placeholder="Step content"
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)]"
                />
              </div>
            ))}

            {canManage && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    setDraftTemplate((current) => ({
                      ...current,
                      steps: [...current.steps, emptyStep()],
                    }))
                  }
                  className="px-3 py-2 rounded-lg text-xs font-mono bg-[var(--alpha-white-5)] border border-[var(--alpha-white-8)] text-[var(--gray-300)] cursor-pointer flex items-center gap-2"
                >
                  <Plus size={12} /> Add Step
                </button>
                <button
                  onClick={() =>
                    runAction("save", async () => {
                      await persistTemplate(draftTemplate.id ? "PATCH" : "POST");
                      setMessage("Onboarding draft saved.");
                    })
                  }
                  disabled={busy === "save"}
                  className="px-3 py-2 rounded-lg text-xs font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20 cursor-pointer disabled:opacity-40"
                >
                  {busy === "save" ? "Saving..." : "Save Draft"}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={14} className="text-[var(--gray-500)]" />
                <span className="font-mono text-xs uppercase text-[var(--gray-500)]">
                  Published Template
                </span>
              </div>
              {activeTemplate ? (
                <>
                  <p className="font-mono text-sm text-[var(--gray-100)] m-0">
                    {activeTemplate.title}
                  </p>
                  <p className="font-mono text-xs text-[var(--gray-500)] m-0 mt-2">
                    Version {activeTemplate.currentVersion} with {activeTemplate.steps.length} steps
                  </p>
                </>
              ) : (
                <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                  No published onboarding template yet.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList size={14} className="text-[var(--gray-500)]" />
                <span className="font-mono text-xs uppercase text-[var(--gray-500)]">
                  Assignment Progress
                </span>
              </div>
              {pendingAssignments.length === 0 ? (
                <p className="font-mono text-xs text-[var(--gray-500)] m-0">
                  No onboarding assignments yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {pendingAssignments.slice(0, 6).map((assignment) => (
                    <div
                      key={assignment.id}
                      className="rounded-lg border border-[var(--alpha-white-8)] bg-[var(--surface-1)] px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs text-[var(--gray-200)] m-0">
                            @{assignment.assigneeGitHubUsername || "pending"}
                          </p>
                          <p className="font-mono text-xs text-[var(--gray-500)] m-0 mt-1">
                            {assignment.templateTitle || "Onboarding"}{" "}
                            {assignment.templateVersionNumber
                              ? `v${assignment.templateVersionNumber}`
                              : ""}
                          </p>
                        </div>
                        <span className="font-mono text-xs text-[var(--gray-500)]">
                          {assignment.status.replace("_", " ")}
                        </span>
                      </div>
                      <div className="mt-3 h-1.5 rounded-full bg-[var(--alpha-white-8)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--accent-green)]"
                          style={{ width: `${assignment.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </GlowCard>

      {message && (
        <div className="rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-4 py-3">
          <p className="font-mono text-xs text-[var(--gray-300)] m-0">{message}</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-4 py-3">
      <p className="font-mono text-xs uppercase text-[var(--gray-500)] m-0">
        {label}
      </p>
      <p className="font-mono text-lg text-[var(--gray-100)] m-0 mt-2">{value}</p>
    </div>
  );
}
