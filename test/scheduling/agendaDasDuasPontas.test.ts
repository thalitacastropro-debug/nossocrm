import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * AS DUAS PONTAS TÊM QUE OLHAR A MESMA AGENDA (21/09/2026).
 *
 * O agendamento da Ana tem dois pontos de decisão, e eles são fáceis de separar sem perceber:
 *
 *   1. a rota de no-show OFERECE até 2 horários na mensagem de resgate;
 *   2. o `agent.service` MARCA de verdade quando o lead responde.
 *
 * Se um usar a agenda do dono do card e o outro a do consultor da board, o modo de falha não é
 * erro nem reunião duplicada: o lead responde "quinta às 10 então", o horário não está na lista
 * daquele turno, `validateDetectedSlot` devolve null e `runScheduling` sai com `{kind:'none'}`.
 * A Ana não marca, não avisa e segue conversando. Falha MUDA — a pior de todas neste sistema.
 *
 * Este teste é estrutural de propósito: ele não exercita comportamento, ele trava o CONTRATO de
 * que as duas pontas passam pela mesma função de resolução, e que o SELECT que alimenta cada uma
 * traz `owner_id`. Sem o campo no SELECT, `deal.owner_id` vem `undefined`, a resolução cai na
 * rede de segurança e TUDO continua verde — que é exatamente como esse bug passaria batido.
 */

const raiz = resolve(__dirname, '..', '..');
const ler = (p: string) => readFileSync(resolve(raiz, p), 'utf8');

const AGENTE = 'lib/ai/agent/agent.service.ts';
const ROTA_NO_SHOW = 'app/api/deals/[dealId]/no-show/route.ts';

describe('agenda do resgate: oferta e marcação usam a mesma resolução', () => {
  it('a ponta que MARCA (agent.service) resolve por donoDaAgenda — passando o DEAL', () => {
    const src = ler(AGENTE);
    expect(src).toContain("from '../scheduling/dono-da-agenda'");
    // ⚠️ O argumento importa tanto quanto a chamada. `donoDaAgenda(null, consultorDaBoard)`
    // compila, tipa e devolve sempre o consultor da board — é o bug original escrito de outro
    // jeito. Um regex que só casa `donoDaAgenda(` passa por cima disso.
    expect(src).toMatch(/consultantUserId:\s*donoDaAgenda\(\s*deal\s*,/);
    // O consultor da board não pode voltar a ser a fonte direta.
    expect(src).not.toMatch(/consultantUserId:\s*boardAIConfig\?\.consultant_user_id/);
  });

  it('a ponta que OFERECE (rota de no-show) resolve por donoDaAgenda', () => {
    const src = ler(ROTA_NO_SHOW);
    expect(src).toContain("from '@/lib/ai/scheduling/dono-da-agenda'");
    expect(src).toMatch(/donoDaAgenda\(/);
  });

  it('os dois SELECTs de deal trazem owner_id — sem ele a resolução cai calada no fallback', () => {
    // Regex frouxo de propósito: quem amanhã precisar de mais um campo do deal não pode quebrar
    // um teste de agendamento. O que importa é que `owner_id` esteja na lista.
    expect(ler(AGENTE)).toMatch(/\.select\('[^']*\bowner_id\b[^']*'\)/);
    expect(ler(ROTA_NO_SHOW)).toMatch(/\.select\('[^']*\bowner_id\b[^']*'\)/);
  });

  it('nenhuma das duas cai em user.id — quem clica no no-show não é quem atende', () => {
    // Um admin opera card dos outros. `?? user.id` faria o resgate ler a agenda de quem clicou.
    const rota = ler(ROTA_NO_SHOW);
    expect(rota).not.toMatch(/donoDaAgenda\([^)]*user\.id/);
    expect(rota).not.toMatch(/consultantUserId\s*=\s*[^;]*\?\?\s*user\.id/);
  });
});
