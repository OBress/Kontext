-- Align activity feed defaults with repo and automation activity.
-- Keep legacy chat/prompt event types in the table constraint so older rows remain valid.

ALTER TABLE public.activity_events
  DROP CONSTRAINT IF EXISTS activity_events_type_check;

ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_type_check CHECK (
    event_type IN (
      'repo_added',
      'repo_deleted',
      'repo_indexed',
      'repo_synced',
      'team_member_joined',
      'team_invite_sent',
      'chat_session',
      'prompt_generated',
      'push',
      'pull_request',
      'issue',
      'create',
      'release',
      'workflow_run'
    )
  );

ALTER TABLE public.user_preferences
  ALTER COLUMN activity_filters SET DEFAULT '{
    "repo_added": true,
    "repo_deleted": true,
    "repo_indexed": true,
    "repo_synced": true,
    "team_member_joined": true,
    "team_invite_sent": true,
    "push": true,
    "pull_request": true,
    "issue": true,
    "create": true,
    "release": true,
    "workflow_run": true
  }'::jsonb;

UPDATE public.user_preferences
SET activity_filters =
  (COALESCE(activity_filters, '{}'::jsonb) - 'chat_session' - 'prompt_generated')
  || jsonb_build_object(
    'repo_added', COALESCE((activity_filters->>'repo_added')::boolean, true),
    'repo_deleted', COALESCE((activity_filters->>'repo_deleted')::boolean, true),
    'repo_indexed', COALESCE((activity_filters->>'repo_indexed')::boolean, true),
    'repo_synced', COALESCE((activity_filters->>'repo_synced')::boolean, true),
    'team_member_joined', COALESCE((activity_filters->>'team_member_joined')::boolean, true),
    'team_invite_sent', COALESCE((activity_filters->>'team_invite_sent')::boolean, true),
    'push', COALESCE((activity_filters->>'push')::boolean, true),
    'pull_request', COALESCE((activity_filters->>'pull_request')::boolean, true),
    'issue', COALESCE((activity_filters->>'issue')::boolean, true),
    'create', COALESCE((activity_filters->>'create')::boolean, true),
    'release', COALESCE((activity_filters->>'release')::boolean, true),
    'workflow_run', COALESCE((activity_filters->>'workflow_run')::boolean, true)
  ),
  updated_at = now();
