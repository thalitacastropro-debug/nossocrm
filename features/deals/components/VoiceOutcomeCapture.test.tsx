import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VoiceOutcomeCapture } from './VoiceOutcomeCapture';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

const review = {
  transcricao: 'fechei com a Valéria, 3 vidas, Amil',
  audioFilePath: `${DEAL_ID}/voice/a.webm`,
  desfecho: {
    desfecho: 'fechou' as const,
    nota_resumo: 'Fechou 3 vidas Amil',
    tarefas: [{ descricao: 'Enviar contrato', data: null }],
    dados_negocio: { operadora: 'Amil', vidas: 3, valor: 2100 },
    objecoes: [],
    motivo_perda: null,
    motivo_perda_detalhe: null,
    reabordar_em: null,
    confidence: 0.9,
  },
};

describe('VoiceOutcomeCapture', () => {
  it('estado ocioso: mostra o botão de gravar', () => {
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} />);
    expect(screen.getByRole('button', { name: /gravar desfecho/i })).toBeInTheDocument();
  });

  it('estado de revisão: campos editáveis + Confirmar + transcrição', () => {
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} __testInitialReview={review} />);
    expect(screen.getByText(/fechei com a Valéria/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Amil')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fechou 3 vidas Amil')).toBeInTheDocument();
    // tarefa ditada aparece na lista
    expect(screen.getByText(/Enviar contrato/)).toBeInTheDocument();
  });

  it('perdeu: expõe o campo de motivo da perda', () => {
    const perdeu = { ...review, desfecho: { ...review.desfecho, desfecho: 'perdeu' as const, motivo_perda: 'concorrente' as const } };
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} __testInitialReview={perdeu} />);
    expect(screen.getByText(/Motivo da perda/i)).toBeInTheDocument();
  });
});

/**
 * O CAMINHO MANUAL (pedido dela em 09/09: *"tem que ter a versão manual tb"*).
 *
 * O formulário completo do desfecho já existia — só que a ÚNICA porta para chegar nele era gravar
 * um áudio. Quem estava no ônibus, num escritório aberto ou simplesmente não queria falar não tinha
 * como registrar o desfecho, e o resultado aparece nos índices de preenchimento: reunião realizada
 * em 11 de 21, prêmio em 1 de 5.
 *
 * A versão manual NÃO é uma segunda tela: é a MESMA revisão, com os campos vazios. Mesmo formulário,
 * mesma rota, mesmas regras — senão as duas divergem no primeiro ajuste.
 */
describe('VoiceOutcomeCapture — preenchimento manual', () => {
  it('estado ocioso oferece a alternativa de escrever', () => {
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} />);
    expect(screen.getByRole('button', { name: /preencher.*m[ãa]o|escrever|manualmente/i })).toBeInTheDocument();
  });

  it('ao escolher escrever, cai no MESMO formulário do desfecho', async () => {
    const user = userEvent.setup();
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} />);
    await user.click(screen.getByRole('button', { name: /preencher.*m[ãa]o|escrever|manualmente/i }));
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument();
    expect(screen.getByText(/Resumo/i)).toBeInTheDocument();
  });

  it('não vem com desfecho escolhido — quem escreve precisa dizer o que houve', async () => {
    const user = userEvent.setup();
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} />);
    await user.click(screen.getByRole('button', { name: /preencher.*m[ãa]o|escrever|manualmente/i }));
    // Um default como "fechou" faria o consultor confirmar sem ler — é assim que dado ruim entra.
    const select = screen.getByLabelText(/desfecho/i) as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('sem desfecho escolhido, o Confirmar fica travado', async () => {
    const user = userEvent.setup();
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} />);
    await user.click(screen.getByRole('button', { name: /preencher.*m[ãa]o|escrever|manualmente/i }));
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
  });

  it('no manual não há transcrição nem player de áudio', async () => {
    const user = userEvent.setup();
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} />);
    await user.click(screen.getByRole('button', { name: /preencher.*m[ãa]o|escrever|manualmente/i }));
    expect(screen.queryByText(/revis[ãa]o/i)).not.toBeInTheDocument();
  });
});

/**
 * O rótulo do campo de valor muda com o desfecho — porque o número muda de significado.
 * "fechou" → prêmio do plano COMPRADO (fecha o mês). Qualquer outro → mensalidade do plano ANTIGO
 * (gatilho da conversa). Um rótulo genérico "Valor" é o que faz o prêmio ser digitado no campo
 * errado, e os dois números são parecidos o bastante para ninguém notar.
 */
describe('VoiceOutcomeCapture — o valor tem dois significados', () => {
  it('em "fechou", o campo é o prêmio do plano vendido', () => {
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} __testInitialReview={review} />);
    expect(screen.getByText(/Prêmio \(plano vendido\)/i)).toBeInTheDocument();
  });

  it('em "vai pensar", o campo é o que o lead paga hoje', () => {
    const pensando = { ...review, desfecho: { ...review.desfecho, desfecho: 'vai_pensar' as const } };
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} __testInitialReview={pensando} />);
    expect(screen.getByText(/Valor que paga hoje/i)).toBeInTheDocument();
    expect(screen.queryByText(/Prêmio/i)).not.toBeInTheDocument();
  });
});
