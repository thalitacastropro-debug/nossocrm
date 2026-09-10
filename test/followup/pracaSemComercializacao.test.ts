/**
 * Praça sem comercialização x cadência de follow-up.
 *
 * O gate de 09/09 impede a Ana de AGENDAR num lead cuja cidade as operadoras não atendem — mas a
 * cadência de follow-up é outro caminho de saída: ela varre o board da SDR sozinha, a cada 15
 * minutos, e manda "ainda por aí?" por três dias. Sem este freio, o lead de Ourinhos não ganhava
 * horário e mesmo assim era perseguido a semana inteira. Não agendar e continuar insistindo é pior
 * do que insistir: é insistir sem ter o que oferecer.
 */
import { describe, it, expect, vi } from 'vitest';
import { runLeadFollowup, type FollowupDeps } from '@/lib/ai/followup/run';
import { COLD_SCHEDULE_MS } from '@/lib/ai/followup/schedule';

const NOW = new Date('2026-07-13T20:00:00.000Z');
const OLD = new Date(NOW.getTime() - COLD_SCHEDULE_MS[0] - 60_000).toISOString();

function makeSupabase(cfg: { deals: unknown[]; conversations: unknown[]; contacts: unknown[] }) {
  const dealUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  function thenable(rows: unknown[]) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit']) b[m] = () => b;
    b.then = (res: (v: { data: unknown[]; error: null }) => void) => res({ data: rows, error: null });
    return b;
  }
  const client = {
    from(table: string) {
      if (table === 'deals') {
        return {
          ...thenable(cfg.deals),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => { dealUpdates.push({ id, patch }); return { error: null }; },
          }),
        };
      }
      if (table === 'messaging_conversations') return thenable(cfg.conversations);
      if (table === 'contacts') return thenable(cfg.contacts);
      if (table === 'messaging_messages') return thenable([]);
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client: client as never, dealUpdates };
}

/** Lead com o toque 0 vencido — só muda a cidade. */
function cenario(cidade: string | null) {
  return makeSupabase({
    deals: [{
      id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo',
      custom_fields: {
        lead_form: { first_touch: { sent_at: OLD } },
        ...(cidade ? { qualificacao: { cidade_uf: cidade } } : {}),
      },
      tags: [],
    }],
    conversations: [{
      id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: OLD,
      last_message_direction: 'outbound', metadata: {},
    }],
    contacts: [{ id: 'c1', name: 'Gabriel Fernandes', ai_paused: false }],
  });
}

function deps(supa: FollowupDeps['supabase'], sendResponse = vi.fn(async () => ({ success: true }))): FollowupDeps {
  return { supabase: supa, now: NOW, sendResponse, generateWarm: vi.fn(async () => null) };
}

describe('follow-up x praça sem comercialização', () => {
  it('lead de praça bloqueada NÃO recebe toque', async () => {
    const { client } = cenario('Ourinhos-SP');
    const enviar = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(deps(client, enviar));
    expect(enviar).not.toHaveBeenCalled();
    expect(r.processed).toBe(0);
  });

  it('e a cadência dele é ENCERRADA, não só pulada — senão volta a rodar a cada 15 min', async () => {
    const { client, dealUpdates } = cenario('Ourinhos-SP');
    await runLeadFollowup(deps(client));
    const patch = dealUpdates.at(-1)?.patch.custom_fields as { followup: Record<string, unknown> };
    expect(patch.followup.stopped).toBe(true);
    expect(patch.followup.stopped_reason).toBe('fora_da_area');
  });

  it('lead de cidade atendida segue recebendo normalmente', async () => {
    const { client } = cenario('São Paulo');
    const enviar = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(deps(client, enviar));
    expect(enviar).toHaveBeenCalled();
    expect(r.processed).toBe(1);
  });
});
