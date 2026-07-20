import { describe, it, expect } from 'vitest';
import { formatMeetingHandoffMessage } from '@/lib/notifications/telegram';

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
