-- Add plaintext google_ai_key column to user_tokens
-- Replaces the encrypted_ai_key / ai_key_iv / ai_key_tag columns
ALTER TABLE public.user_tokens
  ADD COLUMN IF NOT EXISTS google_ai_key text;
