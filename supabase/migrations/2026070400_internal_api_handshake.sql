-- Handshake Edge Function ↔ app sem depender de env no runtime das functions:
-- o segredo interno + a URL base do app moram em organization_settings (ambos os lados leem via service role).
-- Aplicada no banco vivo em 2026-07-04 (com UPDATE gerando o segredo pra org da Niva).

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS internal_api_secret TEXT,
  ADD COLUMN IF NOT EXISTS app_base_url TEXT;

COMMENT ON COLUMN public.organization_settings.internal_api_secret IS
  'Segredo compartilhado webhook->app (X-Internal-Secret). Alternativa ao env INTERNAL_API_SECRET.';
COMMENT ON COLUMN public.organization_settings.app_base_url IS
  'URL base do app Next.js (produção) usada pelas Edge Functions para acionar a IA.';
