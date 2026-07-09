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
