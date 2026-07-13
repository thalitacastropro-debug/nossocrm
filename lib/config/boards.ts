/**
 * IDs canônicos de boards/etapas usados por automações server-side.
 *
 * Centralizados aqui para não espalhar UUIDs mágicos pelo código.
 * Se algum destes for recriado no banco, atualize apenas este arquivo.
 */

/** Board do Consultor (pós-agendamento, ligação humana). */
export const CONSULTOR_BOARD_ID = 'efbaa84e-cf4b-4465-8b50-41afd612088e';

/** Board da SDR IA (Ana) — qualificação e resgate. */
export const ANA_SDR_BOARD_ID = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';

/** Etapa "Resgate No-show" dentro do board da Ana (destino do move-back). */
export const RESGATE_NOSHOW_STAGE_ID = '4df92e8b-2918-44de-b811-a4f50ec67df4';

/** Board "Implantação — ADM" (destino do desfecho `fechou`). */
export const IMPLANTACAO_ADM_BOARD_ID = '851c641a-ac99-404e-83d7-9712425b5fdf';

/** Etapa de entrada "Aguardando Documentação" no board de Implantação. */
export const IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID = '53589d9d-d0a5-4f62-8cda-20c89828a2b3';

/** Board "Nutrição — Reativação" (destino do desfecho `perdeu`). */
export const NUTRICAO_REATIVACAO_BOARD_ID = '4fb31290-2ab4-46ac-83b1-555fbd4908cc';

/** Etapa "Recontato Agendado" no board de Nutrição (todo perdido com lembrete de data). */
export const NUTRICAO_RECONTATO_STAGE_ID = '2ee5e57e-e616-45e0-8e46-34741f64ef14';

/**
 * Etapa "Negociação" dentro do board do Consultor (destino do desfecho `vai_pensar`).
 * ⚠️ CONFIRMAR o UUID completo na F3 (spec dá só o prefixo `86179ae9`): rodar
 *   SELECT id,name FROM board_stages WHERE board_id='efbaa84e-cf4b-4465-8b50-41afd612088e';
 */
export const NEGOCIACAO_STAGE_ID = '86179ae9-0000-0000-0000-000000000000'; // TODO(F3): substituir pelo UUID real
