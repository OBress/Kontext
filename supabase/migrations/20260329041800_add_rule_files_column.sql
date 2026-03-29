-- ============================================================
-- Add rule_files column to generated_prompts
-- Stores structured multi-file rule packages as JSONB
-- ============================================================

ALTER TABLE public.generated_prompts
ADD COLUMN IF NOT EXISTS rule_files jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.generated_prompts.rule_files IS
  'Array of {path, content, scope, description} objects for multi-file rule packages';
