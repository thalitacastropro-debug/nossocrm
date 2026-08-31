-- =====================================================================
-- messaging-media: o bucket existia sem NENHUMA policy
-- =====================================================================
-- Registro no repo de um DDL JA APLICADO em 31/08/2026 (projeto
-- htmgjcelsnldxjbygfcw). Idempotente: rodar de novo nao quebra nada.
--
-- O CASO REAL: o Denilson escreveu para o Bruce as 15:42 de 31/08 — "conforme
-- falamos na ligacao, segue plano de saude da Amil com coparticipacao" — e
-- entao NAO CONSEGUIU anexar o PDF. Ficou 14 minutos travado com o lead
-- esperando, no meio de uma negociacao.
--
-- A CAUSA: `storage.objects` tem RLS ligada e so existiam policies para os
-- buckets `avatars` e `deal-files`. O bucket `messaging-media` nao tinha
-- nenhuma — entao todo INSERT de usuario logado era negado e a rota
-- POST /api/messaging/media/upload (que usa o client do CALLER, nao service
-- role) devolvia "Failed to upload file".
--
-- POR QUE NINGUEM TINHA VISTO EM 3 MESES: a midia que ENTRA (cliente manda foto
-- ou PDF) e gravada pelo WEBHOOK, que roda com service role e passa por cima da
-- RLS. Por isso a base tem midia inbound desde julho e **ZERO midia outbound em
-- toda a sua historia** — o envio nunca funcionou uma vez sequer, nem depois de
-- 25/08, quando o provider da UAZAPI ganhou o `/send/media` e o commit disse que
-- "agora o consultor consegue mandar arquivo". O provider passou a saber enviar;
-- o arquivo é que nunca chegava a existir.
--
-- 📌 LICAO: recurso novo que grava em bucket precisa de policy no MESMO commit.
-- "Funciona no meu teste" costuma ser o service role mentindo por voce.
--
-- ESCOPO POR ORGANIZACAO, e nao "authenticated e pronto": a rota grava em
-- `{organization_id}/{conversationId}/{uuid}.{ext}`, entao a primeira pasta e a
-- organizacao e da pra amarrar a policy nela. Sem isso, qualquer pessoa logada
-- leria PDF, RG, carteirinha e audio de cliente de QUALQUER organizacao — e este
-- bucket e privado exatamente por isso.
--
-- ROLLBACK no fim do arquivo.
-- =====================================================================

drop policy if exists messaging_media_select on storage.objects;
drop policy if exists messaging_media_insert on storage.objects;
drop policy if exists messaging_media_update on storage.objects;
drop policy if exists messaging_media_delete on storage.objects;

-- Ler: membro da organizacao. E o que faz o historico do chat abrir a midia e o
-- que permite a rota assinar a URL que a UAZAPI baixa para enviar.
create policy messaging_media_select on storage.objects for select to authenticated
using (
  bucket_id = 'messaging-media'
  and (storage.foldername(name))[1] = public.minha_org()::text
);

-- Enviar anexo: qualquer membro, na pasta da PROPRIA organizacao.
create policy messaging_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'messaging-media'
  and (storage.foldername(name))[1] = public.minha_org()::text
);

-- Update para o upsert/retry do upload nao quebrar.
create policy messaging_media_update on storage.objects for update to authenticated
using (
  bucket_id = 'messaging-media'
  and (storage.foldername(name))[1] = public.minha_org()::text
)
with check (
  bucket_id = 'messaging-media'
  and (storage.foldername(name))[1] = public.minha_org()::text
);

-- Apagar: so admin. Midia de conversa e prova do atendimento — consultor nao
-- apaga o que o cliente mandou.
create policy messaging_media_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'messaging-media'
  and (storage.foldername(name))[1] = public.minha_org()::text
  and public.e_admin()
);

-- Testado impersonando de verdade em 31/08/2026:
--   Denilson (admin) grava na pasta da propria org ......... PASSA
--   Pedro (vendedor) grava na pasta da propria org ......... PASSA
--   Pedro grava em pasta de OUTRA organizacao .............. BARRADO (42501)

-- =====================================================================
-- ROLLBACK (deixa o envio de anexo quebrado de novo — nao faca sem motivo):
--   drop policy if exists messaging_media_select on storage.objects;
--   drop policy if exists messaging_media_insert on storage.objects;
--   drop policy if exists messaging_media_update on storage.objects;
--   drop policy if exists messaging_media_delete on storage.objects;
-- =====================================================================
