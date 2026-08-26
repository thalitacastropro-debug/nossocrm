import { describe, it, expect } from 'vitest';
import { formatMeetingHandoffMessage, formatRespostaBloqueadaMessage } from '@/lib/notifications/telegram';

describe('formatMeetingHandoffMessage', () => {
  it('monta o aviso positivo com nome + label da reunião', () => {
    const msg = formatMeetingHandoffMessage({
      contactName: 'João',
      meetingLabel: 'Segunda, 20/07, às 15h',
    });
    expect(msg).toContain('Novo lead agendado');
    expect(msg).toContain('João');
    expect(msg).toContain('Segunda, 20/07, às 15h');
    // Sem link quando não há appUrl/dealId
    expect(msg).not.toContain('Abrir no CRM');
  });

  it('inclui o link do CRM quando há appUrl + dealId', () => {
    const msg = formatMeetingHandoffMessage({
      contactName: 'Maria',
      meetingLabel: 'Terça, 21/07, às 10h',
      appUrl: 'https://crm.example.com',
      dealId: 'deal-42',
    });
    expect(msg).toContain('https://crm.example.com/deals/deal-42');
    expect(msg).toContain('Abrir no CRM');
  });

  it('escapa HTML do nome (anti-injeção no parse_mode HTML)', () => {
    const msg = formatMeetingHandoffMessage({
      contactName: '<b>hack</b>',
      meetingLabel: 'Quarta, 22/07, às 9h',
    });
    expect(msg).toContain('&lt;b&gt;hack&lt;/b&gt;');
    expect(msg).not.toContain('<b>hack</b>');
  });
});

// ---------------------------------------------------------------------------
// Resposta da Ana bloqueada pelo validador (§1b) — o alarme que não existia.
// Antes, o bloqueio era só um console.info na Vercel: 6 respostas morreram sem ninguém ver.
// ---------------------------------------------------------------------------
describe('formatRespostaBloqueadaMessage', () => {
  it('diz o que aconteceu, com quem, e que a conversa NÃO foi encerrada', () => {
    const msg = formatRespostaBloqueadaMessage({
      contactName: 'Daniel Luiz Borges',
      issues: ['leakage:declared_ai_pt'],
      ultimaMensagemDoLead: 'Nenhum em especial',
    });
    expect(msg).toContain('Daniel Luiz Borges');
    expect(msg).toContain('leakage:declared_ai_pt');
    expect(msg).toContain('Nenhum em especial');
    expect(msg).toMatch(/bloque/i);
    expect(msg).not.toContain('Abrir no CRM');
  });

  it('inclui o link do CRM quando há appUrl + dealId', () => {
    const msg = formatRespostaBloqueadaMessage({
      contactName: 'Maria',
      issues: ['length_exceeded:5000/4096'],
      appUrl: 'https://crm.example.com',
      dealId: 'deal-7',
    });
    expect(msg).toContain('https://crm.example.com/deals/deal-7');
  });

  it('escapa HTML do nome e da mensagem do lead (anti-injeção no parse_mode HTML)', () => {
    const msg = formatRespostaBloqueadaMessage({
      contactName: '<b>hack</b>',
      issues: ['empty_response'],
      ultimaMensagemDoLead: '<i>xss</i>',
    });
    expect(msg).toContain('&lt;b&gt;hack&lt;/b&gt;');
    expect(msg).toContain('&lt;i&gt;xss&lt;/i&gt;');
  });

  it('aguenta lista de problemas vazia', () => {
    const msg = formatRespostaBloqueadaMessage({ contactName: 'João', issues: [] });
    expect(msg).toContain('João');
    expect(typeof msg).toBe('string');
  });
});
