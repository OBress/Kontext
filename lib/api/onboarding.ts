import type { Schema } from "@google/genai";
import { Type } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAiKey } from "./ai-key";
import { generateStructuredJson } from "./embeddings";
import { ApiError, validationError } from "./errors";
import {
  completeRepoJob,
  createRepoJob,
  failRepoJob,
} from "./repo-jobs";
import { buildFileManifest } from "./repo-intelligence";
import {
  buildTaskSystemInstruction,
  formatEvidencePack,
  PROMPT_GENERATION_CONFIGS,
} from "./prompt-contract";

export const ONBOARDING_STEP_TYPES = [
  "content",
  "guided_explore",
  "quiz",
  "acknowledgement",
] as const;

export type OnboardingStepType = (typeof ONBOARDING_STEP_TYPES)[number];

export const ONBOARDING_TEMPLATE_STATUSES = [
  "draft",
  "published",
  "archived",
] as const;

export type OnboardingTemplateStatus =
  (typeof ONBOARDING_TEMPLATE_STATUSES)[number];

export const ONBOARDING_ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "completed",
  "overdue",
  "cancelled",
] as const;

export type OnboardingAssignmentStatus =
  (typeof ONBOARDING_ASSIGNMENT_STATUSES)[number];

export interface OnboardingStepDraft {
  id?: number;
  stepType: OnboardingStepType;
  title: string;
  description: string;
  content: string;
  quizPayload?: Record<string, unknown>;
}

export interface OnboardingTemplateRecord {
  id: number;
  title: string;
  description: string | null;
  status: OnboardingTemplateStatus;
  currentVersion: number;
  activeVersionId: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  steps: OnboardingStepDraft[];
}

export interface OnboardingAssignmentRecord {
  id: number;
  status: OnboardingAssignmentStatus;
  progressPercent: number;
  currentStep: number;
  score: number | null;
  assigneeUserId: string | null;
  assigneeGitHubUsername: string | null;
  roleTarget: string;
  templateId: number | null;
  templateVersionId: number | null;
  templateTitle: string | null;
  templateVersionNumber: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface RepoMembershipRow {
  role: string;
}

interface OnboardingTemplateRow {
  id: number;
  title: string;
  description: string | null;
  status: OnboardingTemplateStatus;
  current_version: number;
  active_version_id: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface OnboardingStepRow {
  id: number;
  template_id: number;
  step_type: OnboardingStepType;
  title: string;
  description: string | null;
  content: string | null;
  quiz_payload: Record<string, unknown> | null;
  step_order: number;
}

interface OnboardingVersionRow {
  id: number;
  template_id: number;
  version_number: number;
  title: string;
}

interface OnboardingAssignmentRow {
  id: number;
  status: OnboardingAssignmentStatus;
  progress_percent: number;
  current_step: number;
  score: number | null;
  assignee_user_id: string | null;
  assignee_github_username: string | null;
  role_target: string;
  template_id: number | null;
  template_version_id: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface TeamMembershipStateRow {
  role: string;
  onboarding_completed: boolean | null;
  onboarding_step: number | null;
}

interface OnboardingVersionDetailRow {
  id: number;
  template_id: number;
  version_number: number;
  title: string;
  description: string | null;
  steps: unknown;
  step_count: number;
}

interface OnboardingAttemptRow {
  id: number;
  step_order: number;
  attempt_number: number;
  passed: boolean;
  score: number | null;
  response: Record<string, unknown> | null;
  created_at: string;
}

interface GeneratedOnboardingDraft {
  title: string;
  description: string;
  steps: OnboardingStepDraft[];
}

export interface LearnerOnboardingStep extends OnboardingStepDraft {
  stepOrder: number;
}

export interface LearnerOnboardingAttempt {
  id: number;
  stepOrder: number;
  attemptNumber: number;
  passed: boolean;
  score: number | null;
  response: Record<string, unknown>;
  createdAt: string;
}

export interface LearnerOnboardingExperience {
  mode: "assignment" | "preview" | "none";
  membershipRole: string;
  githubLogin: string | null;
  assignment: OnboardingAssignmentRecord | null;
  template: {
    title: string;
    description: string | null;
    versionId: number | null;
    versionNumber: number;
    steps: LearnerOnboardingStep[];
  } | null;
  attempts: LearnerOnboardingAttempt[];
}

function isOnboardingStepType(value: unknown): value is OnboardingStepType {
  return (
    typeof value === "string" &&
    (ONBOARDING_STEP_TYPES as readonly string[]).includes(value)
  );
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... [truncated]`;
}

function normalizeQuizPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeVersionStep(
  step: unknown,
  index: number
): LearnerOnboardingStep {
  const normalized = normalizeOnboardingStep(step, index);
  return {
    ...normalized,
    stepOrder: index,
  };
}

function normalizeVersionSteps(steps: unknown): LearnerOnboardingStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((step, index) => normalizeVersionStep(step, index));
}

export function normalizeOnboardingStep(
  step: unknown,
  index: number
): OnboardingStepDraft {
  if (!step || typeof step !== "object") {
    throw validationError(`Step ${index + 1} is invalid.`);
  }

  const record = step as Record<string, unknown>;
  const stepType = isOnboardingStepType(record.stepType)
    ? record.stepType
    : isOnboardingStepType(record.step_type)
      ? record.step_type
      : "content";

  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : `Step ${index + 1}`;

  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  const content = typeof record.content === "string" ? record.content.trim() : "";

  return {
    stepType,
    title,
    description,
    content,
    quizPayload: normalizeQuizPayload(record.quizPayload || record.quiz_payload),
  };
}

function serializeTemplate(
  template: OnboardingTemplateRow,
  steps: OnboardingStepRow[]
): OnboardingTemplateRecord {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    status: template.status,
    currentVersion: template.current_version,
    activeVersionId: template.active_version_id,
    metadata: template.metadata || {},
    createdAt: template.created_at,
    updatedAt: template.updated_at,
    steps: steps
      .sort((a, b) => a.step_order - b.step_order)
      .map((step) => ({
        id: step.id,
        stepType: step.step_type,
        title: step.title,
        description: step.description || "",
        content: step.content || "",
        quizPayload: step.quiz_payload || {},
      })),
  };
}

export async function assertRepoTeamAccess(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  allowedRoles: string[] = ["owner", "admin"]
): Promise<string> {
  const { data: membership, error } = await supabase
    .from("team_members")
    .select("role")
    .eq("repo_full_name", repoFullName)
    .eq("user_id", userId)
    .single();

  if (error || !membership) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You are not a member of this repository team."
    );
  }

  if (!allowedRoles.includes(membership.role)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You do not have permission to manage onboarding for this repository."
    );
  }

  return (membership as RepoMembershipRow).role;
}

export async function listOnboardingTemplates(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<{
  templates: OnboardingTemplateRecord[];
  activeTemplate: OnboardingTemplateRecord | null;
  latestTemplate: OnboardingTemplateRecord | null;
}> {
  const { data: templateRows, error } = await supabase
    .from("onboarding_templates")
    .select(
      "id, title, description, status, current_version, active_version_id, metadata, created_at, updated_at"
    )
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const templates = (templateRows || []) as OnboardingTemplateRow[];
  const templateIds = templates.map((template) => template.id);

  let steps: OnboardingStepRow[] = [];
  if (templateIds.length > 0) {
    const { data: stepRows, error: stepError } = await supabase
      .from("onboarding_template_steps")
      .select(
        "id, template_id, step_type, title, description, content, quiz_payload, step_order"
      )
      .eq("user_id", userId)
      .eq("repo_full_name", repoFullName)
      .in("template_id", templateIds)
      .order("step_order", { ascending: true });

    if (stepError) throw stepError;
    steps = (stepRows || []) as OnboardingStepRow[];
  }

  const stepsByTemplate = new Map<number, OnboardingStepRow[]>();
  for (const step of steps) {
    const bucket = stepsByTemplate.get(step.template_id) || [];
    bucket.push(step);
    stepsByTemplate.set(step.template_id, bucket);
  }

  const serialized = templates.map((template) =>
    serializeTemplate(template, stepsByTemplate.get(template.id) || [])
  );

  return {
    templates: serialized,
    activeTemplate:
      serialized.find(
        (template) =>
          template.status === "published" && template.activeVersionId !== null
      ) || null,
    latestTemplate: serialized[0] || null,
  };
}

export async function saveOnboardingTemplateDraft(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  templateId?: number | null;
  createdBy: string;
  title: string;
  description?: string | null;
  steps: unknown[];
  metadata?: Record<string, unknown>;
}): Promise<OnboardingTemplateRecord> {
  const normalizedSteps = params.steps.map((step, index) =>
    normalizeOnboardingStep(step, index)
  );

  if (normalizedSteps.length === 0) {
    throw validationError("At least one onboarding step is required.");
  }

  const now = new Date().toISOString();
  let templateId = params.templateId || null;

  if (templateId) {
    const { error: updateError } = await params.supabase
      .from("onboarding_templates")
      .update({
        title: params.title.trim(),
        description: params.description?.trim() || null,
        updated_at: now,
        metadata: params.metadata || {},
      })
      .eq("id", templateId)
      .eq("user_id", params.userId)
      .eq("repo_full_name", params.repoFullName);

    if (updateError) throw updateError;
  } else {
    const { data: created, error: createError } = await params.supabase
      .from("onboarding_templates")
      .insert({
        user_id: params.userId,
        repo_full_name: params.repoFullName,
        title: params.title.trim(),
        description: params.description?.trim() || null,
        status: "draft",
        created_by: params.createdBy,
        metadata: params.metadata || {},
        updated_at: now,
      })
      .select("id")
      .single();

    if (createError || !created) {
      throw createError || new Error("Failed to create onboarding template.");
    }

    templateId = created.id as number;
  }

  await params.supabase
    .from("onboarding_template_steps")
    .delete()
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .eq("template_id", templateId);

  const stepRows = normalizedSteps.map((step, index) => ({
    user_id: params.userId,
    repo_full_name: params.repoFullName,
    template_id: templateId,
    step_order: index,
    step_type: step.stepType,
    title: step.title,
    description: step.description || null,
    content: step.content || null,
    quiz_payload: step.quizPayload || {},
    updated_at: now,
  }));

  const { error: stepInsertError } = await params.supabase
    .from("onboarding_template_steps")
    .insert(stepRows);

  if (stepInsertError) throw stepInsertError;

  const { templates } = await listOnboardingTemplates(
    params.supabase,
    params.userId,
    params.repoFullName
  );

  const template = templates.find((entry) => entry.id === templateId);
  if (!template) {
    throw new Error("Failed to reload onboarding template.");
  }

  return template;
}

export async function publishOnboardingTemplate(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  templateId: number;
  publishedBy: string;
}) {
  const { data: template, error: templateError } = await params.supabase
    .from("onboarding_templates")
    .select(
      "id, title, description, current_version, metadata, created_at, updated_at, status, active_version_id"
    )
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .eq("id", params.templateId)
    .single();

  if (templateError || !template) {
    throw templateError || new Error("Onboarding template not found.");
  }

  const { data: steps, error: stepError } = await params.supabase
    .from("onboarding_template_steps")
    .select(
      "id, template_id, step_type, title, description, content, quiz_payload, step_order"
    )
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .eq("template_id", params.templateId)
    .order("step_order", { ascending: true });

  if (stepError) throw stepError;

  const normalizedSteps = (steps || []).map((step) => ({
    step_type: step.step_type,
    title: step.title,
    description: step.description || "",
    content: step.content || "",
    quiz_payload: step.quiz_payload || {},
  }));

  if (normalizedSteps.length === 0) {
    throw validationError("Templates need at least one step before publishing.");
  }

  const versionNumber = ((template as OnboardingTemplateRow).current_version || 0) + 1;

  const { data: version, error: versionError } = await params.supabase
    .from("onboarding_template_versions")
    .insert({
      user_id: params.userId,
      repo_full_name: params.repoFullName,
      template_id: params.templateId,
      version_number: versionNumber,
      title: template.title,
      description: template.description,
      steps: normalizedSteps,
      step_count: normalizedSteps.length,
      published_by: params.publishedBy,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    throw versionError || new Error("Failed to publish onboarding template.");
  }

  const now = new Date().toISOString();

  await params.supabase
    .from("onboarding_templates")
    .update({
      status: "archived",
      active_version_id: null,
      updated_at: now,
    })
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .eq("status", "published")
    .neq("id", params.templateId);

  const { error: publishError } = await params.supabase
    .from("onboarding_templates")
    .update({
      status: "published",
      current_version: versionNumber,
      active_version_id: version.id,
      updated_at: now,
    })
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .eq("id", params.templateId);

  if (publishError) throw publishError;

  return version.id as number;
}

export async function duplicateOnboardingTemplate(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  templateId: number;
  createdBy: string;
}) {
  const { templates } = await listOnboardingTemplates(
    params.supabase,
    params.userId,
    params.repoFullName
  );
  const source = templates.find((template) => template.id === params.templateId);
  if (!source) {
    throw new ApiError(404, "NOT_FOUND", "Source onboarding template not found.");
  }

  return saveOnboardingTemplateDraft({
    supabase: params.supabase,
    userId: params.userId,
    repoFullName: params.repoFullName,
    createdBy: params.createdBy,
    title: `${source.title} Copy`,
    description: source.description,
    steps: source.steps,
    metadata: {
      source_template_id: source.id,
      duplicated_at: new Date().toISOString(),
    },
  });
}

export async function listOnboardingAssignments(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<{
  assignments: OnboardingAssignmentRecord[];
  summary: Record<OnboardingAssignmentStatus, number> & {
    total: number;
    completionRate: number;
  };
}> {
  const { data: assignmentRows, error } = await supabase
    .from("onboarding_assignments")
    .select(
      "id, status, progress_percent, current_step, score, assignee_user_id, assignee_github_username, role_target, template_id, template_version_id, created_at, started_at, completed_at"
    )
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const assignments = (assignmentRows || []) as OnboardingAssignmentRow[];
  const versionIds = assignments
    .map((assignment) => assignment.template_version_id)
    .filter((value): value is number => typeof value === "number");

  const templateIds = assignments
    .map((assignment) => assignment.template_id)
    .filter((value): value is number => typeof value === "number");

  let versions: OnboardingVersionRow[] = [];
  if (versionIds.length > 0) {
    const { data: versionRows, error: versionError } = await supabase
      .from("onboarding_template_versions")
      .select("id, template_id, version_number, title")
      .eq("user_id", userId)
      .eq("repo_full_name", repoFullName)
      .in("id", versionIds);

    if (versionError) throw versionError;
    versions = (versionRows || []) as OnboardingVersionRow[];
  }

  const versionById = new Map(versions.map((version) => [version.id, version]));
  const templateTitleById = new Map<number, string>();

  if (templateIds.length > 0) {
    const { data: templateRows, error: templateError } = await supabase
      .from("onboarding_templates")
      .select("id, title")
      .eq("user_id", userId)
      .eq("repo_full_name", repoFullName)
      .in("id", templateIds);

    if (templateError) throw templateError;

    for (const row of templateRows || []) {
      templateTitleById.set(row.id as number, row.title as string);
    }
  }

  const summary = {
    assigned: 0,
    in_progress: 0,
    completed: 0,
    overdue: 0,
    cancelled: 0,
    total: assignments.length,
    completionRate: 0,
  } as Record<OnboardingAssignmentStatus, number> & {
    total: number;
    completionRate: number;
  };

  const serialized = assignments.map((assignment) => {
    summary[assignment.status] += 1;
    const version = assignment.template_version_id
      ? versionById.get(assignment.template_version_id)
      : null;

    return {
      id: assignment.id,
      status: assignment.status,
      progressPercent: assignment.progress_percent,
      currentStep: assignment.current_step,
      score: assignment.score ? Number(assignment.score) : null,
      assigneeUserId: assignment.assignee_user_id,
      assigneeGitHubUsername: assignment.assignee_github_username,
      roleTarget: assignment.role_target,
      templateId: assignment.template_id,
      templateVersionId: assignment.template_version_id,
      templateTitle:
        version?.title ||
        (assignment.template_id
          ? templateTitleById.get(assignment.template_id) || null
          : null),
      templateVersionNumber: version?.version_number || null,
      createdAt: assignment.created_at,
      startedAt: assignment.started_at,
      completedAt: assignment.completed_at,
    };
  });

  summary.completionRate =
    summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  return {
    assignments: serialized,
    summary,
  };
}

export async function createOnboardingAssignmentForInvite(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  inviteId: number;
  githubUsername: string;
  role: string;
  assignedBy: string;
}) {
  const shouldAssignByDefault = ["member", "viewer"].includes(params.role);
  if (!shouldAssignByDefault) {
    return null;
  }

  const { data: template } = await params.supabase
    .from("onboarding_templates")
    .select("id, active_version_id, current_version, title")
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .eq("status", "published")
    .not("active_version_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!template?.active_version_id) {
    return null;
  }

  const repoJob = await createRepoJob(params.supabase, {
    userId: params.userId,
    repoFullName: params.repoFullName,
    jobType: "onboarding_assign",
    trigger: "invite",
    status: "running",
    title: `Assign onboarding to @${params.githubUsername}`,
    progressPercent: 30,
    metadata: {
      invite_id: params.inviteId,
      template_id: template.id,
      template_version_id: template.active_version_id,
      github_username: params.githubUsername,
    },
  });

  try {
    const { data: assignment, error } = await params.supabase
      .from("onboarding_assignments")
      .upsert(
        {
          user_id: params.userId,
          repo_full_name: params.repoFullName,
          template_id: template.id,
          template_version_id: template.active_version_id,
          invite_id: params.inviteId,
          assignee_github_username: params.githubUsername,
          assigned_by: params.assignedBy,
          role_target: params.role,
          status: "assigned",
          progress_percent: 0,
          current_step: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,repo_full_name,invite_id" }
      )
      .select("*")
      .single();

    if (error || !assignment) {
      throw error || new Error("Failed to create onboarding assignment.");
    }

    await params.supabase
      .from("team_invites")
      .update({
        onboarding_template_version_id: template.active_version_id,
      })
      .eq("id", params.inviteId);

    await completeRepoJob(
      params.supabase,
      repoJob.id,
      `Assigned onboarding v${template.current_version} to @${params.githubUsername}`,
      {
        invite_id: params.inviteId,
        assignment_id: assignment.id,
      }
    );

    return assignment;
  } catch (error: unknown) {
    await failRepoJob(
      params.supabase,
      repoJob.id,
      error instanceof Error ? error.message : "Failed to assign onboarding."
    );
    throw error;
  }
}

const ONBOARDING_STEP_TYPE_SCHEMA: Schema = {
  type: Type.STRING,
  format: "enum",
  enum: [...ONBOARDING_STEP_TYPES],
};

const ONBOARDING_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
    },
    description: {
      type: Type.STRING,
    },
    steps: {
      type: Type.ARRAY,
      minItems: "5",
      maxItems: "7",
      items: {
        type: Type.OBJECT,
        properties: {
          step_type: ONBOARDING_STEP_TYPE_SCHEMA,
          title: {
            type: Type.STRING,
          },
          description: {
            type: Type.STRING,
          },
          content: {
            type: Type.STRING,
          },
          quiz_payload: {
            type: Type.OBJECT,
            properties: {
              question: {
                type: Type.STRING,
              },
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
              },
              correct_option_index: {
                type: Type.INTEGER,
              },
              explanation: {
                type: Type.STRING,
              },
            },
          },
        },
        required: ["step_type", "title", "description", "content"],
      },
    },
  },
  required: ["title", "description", "steps"],
};

export function buildOnboardingSystemInstruction(): string {
  return buildTaskSystemInstruction({
    task: "technical_teacher",
    role: "Kontext Onboarding",
    mission:
      "Create concise, repository-specific onboarding walkthroughs for a new engineer.",
    outputStyle: [
      "Return structured JSON only.",
      "Keep each step concise, practical, and grounded in the repository evidence.",
      "Teach the engineer how the repo works before asking them to memorize details.",
    ],
    taskRules: [
      "The walkthrough must progress from repo orientation to concrete exploration, then to a safe first contribution mindset.",
      "Use concrete directories, files, systems, and workflows when the evidence supports them.",
      "If the evidence is partial, keep the walkthrough modest instead of inventing systems or workflows.",
    ],
  });
}

function normalizeGeneratedOnboardingDraft(
  value: unknown
): GeneratedOnboardingDraft {
  if (!value || typeof value !== "object") {
    throw new ApiError(
      502,
      "AI_PARSE_ERROR",
      "Onboarding draft response was not an object."
    );
  }

  const record = value as Record<string, unknown>;
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : "Repository onboarding";
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps = rawSteps.map((step, index) =>
    normalizeOnboardingStep(step, index)
  );

  if (steps.length < 5 || steps.length > 7) {
    throw new ApiError(
      502,
      "AI_PARSE_ERROR",
      "Onboarding draft must contain 5 to 7 steps."
    );
  }

  const quizCount = steps.filter((step) => step.stepType === "quiz").length;
  const acknowledgementCount = steps.filter(
    (step) => step.stepType === "acknowledgement"
  ).length;

  if (quizCount !== 1 || acknowledgementCount !== 1) {
    throw new ApiError(
      502,
      "AI_PARSE_ERROR",
      "Onboarding draft must include exactly one quiz step and one acknowledgement step."
    );
  }

  return {
    title,
    description,
    steps,
  };
}

export function buildOnboardingPrompt(params: {
  repoFullName: string;
  repoDescription: string | null;
  language: string | null;
  defaultBranch: string | null;
  lastSyncedSha: string | null;
  fileManifest: string;
  recentCommits: string;
  architectureSummary: string;
}) {
  const evidencePack = formatEvidencePack({
    summary:
      "Use the repository evidence to teach a new engineer how to navigate and work in this codebase.",
    facts: [
      { label: "Repository", value: params.repoFullName, confidence: "exact" },
      {
        label: "Repository description",
        value: params.repoDescription || "Not available",
        confidence: params.repoDescription ? "exact" : "unknown",
      },
      {
        label: "Primary language",
        value: params.language || "Unknown",
        confidence: params.language ? "exact" : "unknown",
      },
      {
        label: "Default branch",
        value: params.defaultBranch || "main",
        confidence: params.defaultBranch ? "exact" : "inferred",
      },
      {
        label: "Last synced SHA",
        value: params.lastSyncedSha || "Unknown",
        confidence: params.lastSyncedSha ? "exact" : "unknown",
      },
    ],
    excerpts: [
      {
        title: "File manifest",
        source: params.repoFullName,
        reason: "Use this to point learners to concrete directories and files.",
        content: params.fileManifest || "No indexed files yet.",
      },
      {
        title: "Recent development context",
        source: params.repoFullName,
        reason:
          "Use this to explain active areas of the codebase and what changed recently.",
        content: params.recentCommits || "No recent commits available.",
      },
      {
        title: "Architecture summary",
        source: params.repoFullName,
        reason:
          "Use this to give the learner a mental model before they dive into files.",
        content:
          params.architectureSummary || "No architecture summary available.",
      },
    ],
  });

  return [
    "Create an onboarding walkthrough for a new engineer joining this repository.",
    "",
    evidencePack,
    "",
    "Walkthrough requirements:",
    "- Return JSON matching the structure below.",
    "- Produce 5 to 7 steps.",
    "- Include exactly 1 quiz step and exactly 1 acknowledgement step.",
    "- Sequence the walkthrough from orientation, to local workflow, to key systems, to practical exploration, then reinforcement.",
    "- Mention concrete directories, files, commands, or systems when supported by the evidence.",
    "- Keep each step concise and useful.",
    "",
    "Return JSON matching this exact structure:",
    '{ "title": "...", "description": "...",',
    '  "steps": [{ "step_type": "orientation|local_workflow|system_deep_dive|exploration|quiz|acknowledgement",',
    '    "title": "...", "description": "...", "content": "markdown content...",',
    '    "quiz_payload": { "question": "...", "options": ["A","B","C","D"], "correct_option_index": 0, "explanation": "..." } }] }',
    "Note: quiz_payload is only required for quiz steps.",
  ].join("\n");
}

export async function generateOnboardingDraft(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  requestedBy: string;
  apiKey?: string | null;
}) {
  const apiKey = params.apiKey || (await resolveAiKey(params.userId));
  if (!apiKey) {
    throw new ApiError(
      400,
      "API_KEY_REQUIRED",
      "A stored Google AI key or x-google-api-key header is required to generate onboarding."
    );
  }

  const repoJob = await createRepoJob(params.supabase, {
    userId: params.userId,
    repoFullName: params.repoFullName,
    jobType: "onboarding_generate",
    trigger: "manual",
    status: "running",
    title: "Generating onboarding draft",
    progressPercent: 20,
  });

  try {
    const { data: repo, error: repoError } = await params.supabase
      .from("repos")
      .select(
        "description, language, default_branch, last_synced_sha, architecture_analysis"
      )
      .eq("user_id", params.userId)
      .eq("full_name", params.repoFullName)
      .single();

    if (repoError || !repo) {
      throw repoError || new Error("Repository not found.");
    }

    const { data: files, error: filesError } = await params.supabase
      .from("repo_files")
      .select("file_path")
      .eq("user_id", params.userId)
      .eq("repo_full_name", params.repoFullName)
      .order("file_path", { ascending: true })
      .limit(120);

    if (filesError) throw filesError;

    const { data: commits, error: commitsError } = await params.supabase
      .from("repo_commits")
      .select("sha, message, ai_summary, committed_at")
      .eq("user_id", params.userId)
      .eq("repo_full_name", params.repoFullName)
      .order("committed_at", { ascending: false })
      .limit(12);

    if (commitsError) throw commitsError;

    const filePaths = (files || []).map((row) => row.file_path as string);
    const fileManifest = buildFileManifest(filePaths, filePaths.slice(0, 16));
    const recentCommits = (commits || [])
      .map(
        (commit) =>
          `- ${commit.sha}: ${commit.message}${commit.ai_summary ? ` | ${commit.ai_summary}` : ""}`
      )
      .join("\n");
    const architectureSummary = truncate(
      JSON.stringify(repo.architecture_analysis || {}, null, 2),
      8000
    );

    const parsed = await generateStructuredJson<GeneratedOnboardingDraft>(
      apiKey,
      buildOnboardingPrompt({
        repoFullName: params.repoFullName,
        repoDescription: repo.description || null,
        language: repo.language || null,
        defaultBranch: repo.default_branch || null,
        lastSyncedSha: repo.last_synced_sha || null,
        fileManifest,
        recentCommits,
        architectureSummary,
      }),
      {
        systemInstruction: buildOnboardingSystemInstruction(),
        generationConfig: PROMPT_GENERATION_CONFIGS.structuredJson,
        responseSchema: ONBOARDING_RESPONSE_SCHEMA,
        transform: normalizeGeneratedOnboardingDraft,
      }
    );
    const { latestTemplate } = await listOnboardingTemplates(
      params.supabase,
      params.userId,
      params.repoFullName
    );

    const template = await saveOnboardingTemplateDraft({
      supabase: params.supabase,
      userId: params.userId,
      repoFullName: params.repoFullName,
      templateId: latestTemplate?.id || null,
      createdBy: params.requestedBy,
      title: parsed.title,
      description: parsed.description,
      steps: parsed.steps,
      metadata: {
        generated_by_ai: true,
        generated_at: new Date().toISOString(),
      },
    });

    await completeRepoJob(
      params.supabase,
      repoJob.id,
      `Generated onboarding draft with ${template.steps.length} steps.`,
      {
        template_id: template.id,
        step_count: template.steps.length,
      }
    );

    return template;
  } catch (error: unknown) {
    await failRepoJob(
      params.supabase,
      repoJob.id,
      error instanceof Error ? error.message : "Failed to generate onboarding."
    );
    throw error;
  }
}

async function getTeamMembershipState(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<TeamMembershipStateRow> {
  const { data, error } = await supabase
    .from("team_members")
    .select("role, onboarding_completed, onboarding_step")
    .eq("repo_full_name", repoFullName)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You are not a member of this repository team."
    );
  }

  return data as TeamMembershipStateRow;
}

async function getClaimedAssignment(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  assigneeUserId: string
): Promise<OnboardingAssignmentRow | null> {
  const { data } = await supabase
    .from("onboarding_assignments")
    .select(
      "id, status, progress_percent, current_step, score, assignee_user_id, assignee_github_username, role_target, template_id, template_version_id, created_at, started_at, completed_at"
    )
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .eq("assignee_user_id", assigneeUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as OnboardingAssignmentRow | null) || null;
}

async function claimAssignmentByGitHubLogin(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  assigneeUserId: string;
  githubLogin: string | null;
}): Promise<OnboardingAssignmentRow | null> {
  if (!params.githubLogin) return null;

  const { data } = await params.supabase
    .from("onboarding_assignments")
    .select(
      "id, status, progress_percent, current_step, score, assignee_user_id, assignee_github_username, role_target, template_id, template_version_id, created_at, started_at, completed_at"
    )
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .is("assignee_user_id", null)
    .ilike("assignee_github_username", params.githubLogin)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const assignment = (data as OnboardingAssignmentRow | null) || null;
  if (!assignment) return null;

  const { data: claimed, error } = await params.supabase
    .from("onboarding_assignments")
    .update({
      assignee_user_id: params.assigneeUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignment.id)
    .select(
      "id, status, progress_percent, current_step, score, assignee_user_id, assignee_github_username, role_target, template_id, template_version_id, created_at, started_at, completed_at"
    )
    .single();

  if (error || !claimed) {
    throw error || new Error("Failed to claim onboarding assignment.");
  }

  return claimed as OnboardingAssignmentRow;
}

async function getOnboardingVersion(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  versionId: number
): Promise<OnboardingVersionDetailRow | null> {
  const { data } = await supabase
    .from("onboarding_template_versions")
    .select("id, template_id, version_number, title, description, steps, step_count")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .eq("id", versionId)
    .maybeSingle();

  return (data as OnboardingVersionDetailRow | null) || null;
}

async function getLatestPublishedVersion(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<OnboardingVersionDetailRow | null> {
  const { data: template } = await supabase
    .from("onboarding_templates")
    .select("active_version_id")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .eq("status", "published")
    .not("active_version_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!template?.active_version_id) {
    return null;
  }

  return getOnboardingVersion(
    supabase,
    userId,
    repoFullName,
    template.active_version_id as number
  );
}

async function ensureMemberAssignment(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  assigneeUserId: string;
  membershipRole: string;
  version: OnboardingVersionDetailRow;
}): Promise<OnboardingAssignmentRow> {
  const { data: assignment, error } = await params.supabase
    .from("onboarding_assignments")
    .insert({
      user_id: params.userId,
      repo_full_name: params.repoFullName,
      template_id: params.version.template_id,
      template_version_id: params.version.id,
      assignee_user_id: params.assigneeUserId,
      role_target: params.membershipRole,
      status: "assigned",
      progress_percent: 0,
      current_step: 0,
      updated_at: new Date().toISOString(),
    })
    .select(
      "id, status, progress_percent, current_step, score, assignee_user_id, assignee_github_username, role_target, template_id, template_version_id, created_at, started_at, completed_at"
    )
    .single();

  if (error || !assignment) {
    throw error || new Error("Failed to create onboarding assignment.");
  }

  return assignment as OnboardingAssignmentRow;
}

async function listAssignmentAttempts(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  assignmentId: number
): Promise<LearnerOnboardingAttempt[]> {
  const { data, error } = await supabase
    .from("onboarding_step_attempts")
    .select("id, step_order, attempt_number, passed, score, response, created_at")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .eq("assignment_id", assignmentId)
    .order("step_order", { ascending: true })
    .order("attempt_number", { ascending: true });

  if (error) throw error;

  return ((data || []) as OnboardingAttemptRow[]).map((attempt) => ({
    id: attempt.id,
    stepOrder: attempt.step_order,
    attemptNumber: attempt.attempt_number,
    passed: attempt.passed,
    score: attempt.score ? Number(attempt.score) : null,
    response: attempt.response || {},
    createdAt: attempt.created_at,
  }));
}

function serializeAssignmentForLearner(
  assignment: OnboardingAssignmentRow,
  version: OnboardingVersionDetailRow
): OnboardingAssignmentRecord {
  return {
    id: assignment.id,
    status: assignment.status,
    progressPercent: assignment.progress_percent,
    currentStep: assignment.current_step,
    score: assignment.score ? Number(assignment.score) : null,
    assigneeUserId: assignment.assignee_user_id,
    assigneeGitHubUsername: assignment.assignee_github_username,
    roleTarget: assignment.role_target,
    templateId: assignment.template_id,
    templateVersionId: assignment.template_version_id,
    templateTitle: version.title,
    templateVersionNumber: version.version_number,
    createdAt: assignment.created_at,
    startedAt: assignment.started_at,
    completedAt: assignment.completed_at,
  };
}

function calculateProgressPercent(currentStep: number, stepCount: number) {
  if (stepCount <= 0) return 0;
  if (stepCount === 1) {
    return currentStep > 0 ? 100 : 0;
  }
  return Math.max(
    0,
    Math.min(100, Math.round((currentStep / Math.max(stepCount - 1, 1)) * 100))
  );
}

async function syncTeamMembershipProgress(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  assigneeUserId: string;
  currentStep: number;
  completed: boolean;
}) {
  await params.supabase
    .from("team_members")
    .update({
      onboarding_step: params.currentStep,
      onboarding_completed: params.completed,
    })
    .eq("repo_full_name", params.repoFullName)
    .eq("user_id", params.assigneeUserId);
}

export async function getCurrentOnboardingExperience(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  assigneeUserId: string;
  githubLogin?: string | null;
}): Promise<LearnerOnboardingExperience> {
  const membership = await getTeamMembershipState(
    params.supabase,
    params.assigneeUserId,
    params.repoFullName
  );

  let assignment =
    (await getClaimedAssignment(
      params.supabase,
      params.userId,
      params.repoFullName,
      params.assigneeUserId
    )) ||
    (await claimAssignmentByGitHubLogin({
      supabase: params.supabase,
      userId: params.userId,
      repoFullName: params.repoFullName,
      assigneeUserId: params.assigneeUserId,
      githubLogin: params.githubLogin || null,
    }));

  let version =
    assignment?.template_version_id
      ? await getOnboardingVersion(
          params.supabase,
          params.userId,
          params.repoFullName,
          assignment.template_version_id
        )
      : null;

  if (!assignment) {
    const publishedVersion = await getLatestPublishedVersion(
      params.supabase,
      params.userId,
      params.repoFullName
    );

    if (
      publishedVersion &&
      ["member", "viewer"].includes(membership.role)
    ) {
      assignment = await ensureMemberAssignment({
        supabase: params.supabase,
        userId: params.userId,
        repoFullName: params.repoFullName,
        assigneeUserId: params.assigneeUserId,
        membershipRole: membership.role,
        version: publishedVersion,
      });
      version = publishedVersion;
    } else if (publishedVersion && ["owner", "admin"].includes(membership.role)) {
      return {
        mode: "preview",
        membershipRole: membership.role,
        githubLogin: params.githubLogin || null,
        assignment: null,
        template: {
          title: publishedVersion.title,
          description: publishedVersion.description,
          versionId: publishedVersion.id,
          versionNumber: publishedVersion.version_number,
          steps: normalizeVersionSteps(publishedVersion.steps),
        },
        attempts: [],
      };
    }
  }

  if (!assignment || !version) {
    return {
      mode: "none",
      membershipRole: membership.role,
      githubLogin: params.githubLogin || null,
      assignment: null,
      template: null,
      attempts: [],
    };
  }

  const attempts = await listAssignmentAttempts(
    params.supabase,
    params.userId,
    params.repoFullName,
    assignment.id
  );

  return {
    mode: "assignment",
    membershipRole: membership.role,
    githubLogin: params.githubLogin || null,
    assignment: serializeAssignmentForLearner(assignment, version),
    template: {
      title: version.title,
      description: version.description,
      versionId: version.id,
      versionNumber: version.version_number,
      steps: normalizeVersionSteps(version.steps),
    },
    attempts,
  };
}

export async function updateCurrentOnboardingProgress(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  assigneeUserId: string;
  githubLogin?: string | null;
  action: "start" | "save_progress" | "complete";
  currentStep?: number;
}) {
  const experience = await getCurrentOnboardingExperience({
    supabase: params.supabase,
    userId: params.userId,
    repoFullName: params.repoFullName,
    assigneeUserId: params.assigneeUserId,
    githubLogin: params.githubLogin || null,
  });

  if (experience.mode !== "assignment" || !experience.assignment || !experience.template) {
    throw new ApiError(404, "NOT_FOUND", "No onboarding assignment found for this user.");
  }

  const steps = experience.template.steps;
  const maxStep = Math.max(steps.length - 1, 0);
  const requestedStep =
    typeof params.currentStep === "number" ? Math.max(0, Math.min(maxStep, params.currentStep)) : experience.assignment.currentStep;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (params.action === "start") {
    updates.status =
      experience.assignment.status === "completed" ? "completed" : "in_progress";
    updates.started_at = experience.assignment.startedAt || new Date().toISOString();
  }

  if (params.action === "save_progress") {
    updates.status =
      experience.assignment.status === "completed" ? "completed" : "in_progress";
    updates.started_at = experience.assignment.startedAt || new Date().toISOString();
    updates.current_step = requestedStep;
    updates.progress_percent = calculateProgressPercent(requestedStep, steps.length);
  }

  if (params.action === "complete") {
    updates.status = "completed";
    updates.current_step = maxStep;
    updates.progress_percent = 100;
    updates.completed_at = new Date().toISOString();
  }

  const { error } = await params.supabase
    .from("onboarding_assignments")
    .update(updates)
    .eq("id", experience.assignment.id)
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName);

  if (error) throw error;

  await syncTeamMembershipProgress({
    supabase: params.supabase,
    userId: params.userId,
    repoFullName: params.repoFullName,
    assigneeUserId: params.assigneeUserId,
    currentStep:
      params.action === "complete"
        ? maxStep
        : params.action === "save_progress"
          ? requestedStep
          : experience.assignment.currentStep,
    completed: params.action === "complete",
  });

  return getCurrentOnboardingExperience({
    supabase: params.supabase,
    userId: params.userId,
    repoFullName: params.repoFullName,
    assigneeUserId: params.assigneeUserId,
    githubLogin: params.githubLogin || null,
  });
}

export async function submitCurrentOnboardingQuizAttempt(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  assigneeUserId: string;
  githubLogin?: string | null;
  stepOrder: number;
  selectedOptionIndex: number;
}) {
  const experience = await getCurrentOnboardingExperience({
    supabase: params.supabase,
    userId: params.userId,
    repoFullName: params.repoFullName,
    assigneeUserId: params.assigneeUserId,
    githubLogin: params.githubLogin || null,
  });

  if (experience.mode !== "assignment" || !experience.assignment || !experience.template) {
    throw new ApiError(404, "NOT_FOUND", "No onboarding assignment found for this user.");
  }

  const step = experience.template.steps.find(
    (entry) => entry.stepOrder === params.stepOrder
  );
  if (!step || step.stepType !== "quiz") {
    throw new ApiError(400, "INVALID_STEP", "That step is not a quiz.");
  }

  const quizPayload = step.quizPayload || {};
  const correctOptionIndex =
    typeof quizPayload.correct_option_index === "number"
      ? quizPayload.correct_option_index
      : -1;
  const passed = params.selectedOptionIndex === correctOptionIndex;

  const { data: latestAttempt } = await params.supabase
    .from("onboarding_step_attempts")
    .select("attempt_number")
    .eq("user_id", params.userId)
    .eq("repo_full_name", params.repoFullName)
    .eq("assignment_id", experience.assignment.id)
    .eq("step_order", params.stepOrder)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const attemptNumber =
    typeof latestAttempt?.attempt_number === "number"
      ? latestAttempt.attempt_number + 1
      : 1;

  const { data: attempt, error } = await params.supabase
    .from("onboarding_step_attempts")
    .insert({
      user_id: params.userId,
      repo_full_name: params.repoFullName,
      assignment_id: experience.assignment.id,
      step_order: params.stepOrder,
      step_title: step.title,
      attempt_number: attemptNumber,
      passed,
      score: passed ? 100 : 0,
      response: {
        selected_option_index: params.selectedOptionIndex,
        correct_option_index: correctOptionIndex,
      },
    })
    .select("id, step_order, attempt_number, passed, score, response, created_at")
    .single();

  if (error || !attempt) {
    throw error || new Error("Failed to save onboarding attempt.");
  }

  if (experience.assignment.status === "assigned") {
    await params.supabase
      .from("onboarding_assignments")
      .update({
        status: "in_progress",
        started_at: experience.assignment.startedAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", experience.assignment.id);
  }

  return {
    passed,
    correctOptionIndex,
    explanation:
      typeof quizPayload.explanation === "string"
        ? quizPayload.explanation
        : null,
    attempt: {
      id: attempt.id,
      stepOrder: attempt.step_order,
      attemptNumber: attempt.attempt_number,
      passed: attempt.passed,
      score: attempt.score ? Number(attempt.score) : null,
      response: (attempt.response as Record<string, unknown>) || {},
      createdAt: attempt.created_at,
    } satisfies LearnerOnboardingAttempt,
  };
}
