-- GRAVAÇÃO DE DESFECHO QUE NÃO VIROU DESFECHO (09/10/2026).
--
-- A rota /api/deals/[id]/call-outcome sobe o áudio ANTES de transcrever. Qualquer coisa que
-- falhe depois disso — a IA, o limite de 60s da função, o modal fechado antes do Confirmar,
-- a aba recarregada — deixava o arquivo no storage e NADA registrava que aquela gravação ficou
-- sem desfecho. O trabalho do consultor sumia calado.
--
-- Caso que abriu: Alan Ferreira, 08/10 17:59 — o Pedro gravou, o card não tinha desfecho, nada
-- aplicou, e os logs da Vercel (1 hora no Hobby) já não existiam para dizer por quê. Ao medir:
-- 1 em cada 5 cards com áudio tinha gravação sem desfecho, inclusive as que a trava por card
-- (consertada em 83f9b4e) engoliu e que o conserto não devolveu — Viviani, Sara, Paulo.
--
-- O estado passa a morar na própria linha do arquivo:
--   pendente     → subiu e ainda não virou desfecho (aparece no card com "Retomar")
--   aplicado     → o Confirmar gravou o desfecho desta gravação
--   substituido  → o consultor regravou e aplicou a gravação seguinte do mesmo card
--   descartado   → o consultor disse que não quer esta gravação (o arquivo FICA)
--
-- `desfecho_transcricao` guarda o texto assim que a IA devolve: retomar não paga a transcrição
-- de novo, e o estouro de tempo na extração não joga fora a transcrição que já tinha dado certo.
-- `desfecho_erro` guarda o motivo da falha no banco — o log da Vercel some em 1 hora.

alter table public.deal_files
  add column if not exists desfecho_status text,
  add column if not exists desfecho_transcricao text,
  add column if not exists desfecho_erro text,
  add column if not exists desfecho_erro_em timestamptz,
  add column if not exists desfecho_resolvido_em timestamptz;

alter table public.deal_files
  drop constraint if exists deal_files_desfecho_status_check;
alter table public.deal_files
  add constraint deal_files_desfecho_status_check
  check (desfecho_status is null or desfecho_status in ('pendente', 'aplicado', 'substituido', 'descartado'));

-- Backfill das gravações que já existem. `voice_calls` nunca existiu neste banco (o insert da
-- rota falhava calado), então o único rastro de "esta gravação virou desfecho" é a nota
-- 'Desfecho da call' que o apply cria. Nos casos que funcionaram ela nasce de 10s a 2min depois
-- do upload — 30 minutos cobre com folga, inclusive quem regravou e aplicou a segunda.
with voz as (
  select f.id, f.deal_id, f.created_at,
    exists (
      select 1 from public.activities a
      where a.deal_id = f.deal_id and a.type = 'NOTE' and a.title = 'Desfecho da call'
        and a.created_at between f.created_at and f.created_at + interval '30 minutes'
    ) as aplicada_logo,
    (
      select min(a.created_at) from public.activities a
      where a.deal_id = f.deal_id and a.type = 'NOTE' and a.title = 'Desfecho da call'
        and a.created_at > f.created_at
    ) as desfecho_posterior
  from public.deal_files f
  where f.file_path like '%/voice/%' and f.desfecho_status is null
)
update public.deal_files f
set desfecho_status = case
      when voz.aplicada_logo then 'aplicado'
      when voz.desfecho_posterior is not null then 'substituido'
      else 'pendente'
    end,
    desfecho_resolvido_em = case
      when voz.aplicada_logo or voz.desfecho_posterior is not null then voz.desfecho_posterior
      else null
    end
from voz
where voz.id = f.id;

create index if not exists deal_files_desfecho_pendente_idx
  on public.deal_files (deal_id, created_at desc)
  where desfecho_status = 'pendente';
