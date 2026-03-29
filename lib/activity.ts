export const ACTIVITY_EVENT_TYPES = [
  "repo_added",
  "repo_deleted",
  "repo_indexed",
  "repo_synced",
  "team_member_joined",
  "team_invite_sent",
  "push",
  "pull_request",
  "issue",
  "create",
  "release",
  "workflow_run",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export type ActivityFilterMap = Record<ActivityEventType, boolean>;

export const DEFAULT_ACTIVITY_FILTERS = ACTIVITY_EVENT_TYPES.reduce(
  (filters, eventType) => {
    filters[eventType] = true;
    return filters;
  },
  {} as ActivityFilterMap
);

export const KONTEXT_ACTIVITY_EVENTS: ReadonlyArray<{
  key: ActivityEventType;
  label: string;
}> = [
  { key: "repo_added", label: "Repo added" },
  { key: "repo_deleted", label: "Repo deleted" },
  { key: "repo_indexed", label: "Repo indexed" },
  { key: "repo_synced", label: "Repo synced" },
  { key: "team_member_joined", label: "Team member joined" },
  { key: "team_invite_sent", label: "Team invite sent" },
];

export const GITHUB_ACTIVITY_EVENTS: ReadonlyArray<{
  key: ActivityEventType;
  label: string;
}> = [
  { key: "push", label: "Push / commits" },
  { key: "pull_request", label: "Pull requests" },
  { key: "issue", label: "Issues" },
  { key: "create", label: "Branch / tag created" },
  { key: "release", label: "Releases" },
  { key: "workflow_run", label: "GitHub Actions" },
];

const ACTIVITY_EVENT_TYPE_SET = new Set<string>(ACTIVITY_EVENT_TYPES);

export function isActivityEventType(value: string): value is ActivityEventType {
  return ACTIVITY_EVENT_TYPE_SET.has(value);
}
