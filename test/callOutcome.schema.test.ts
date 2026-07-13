import { describe, it, expect } from 'vitest';
import { DesfechoSchema } from '@/lib/ai/call-outcome/schemas';

const base = {
  desfecho: 'fechou',
  nota_resumo: 'Fechou com a Valéria, 3 vidas, Amil.',
  tarefas: [{ descricao: 'Enviar contrato', data: '2026-07-14T13:00:00.000Z' }],
  dados_negocio: { operadora: 'Amil', vidas: 3, valor: 2100 },
  objecoes: [],
  motivo_perda: null,
  motivo_perda_detalhe: null,
  reabordar_em: null,
  confidence: 0.9,
};

describe('DesfechoSchema', () => {
  it('valida um desfecho completo', () => {
    expect(DesfechoSchema.safeParse(base).success).toBe(true);
  });
  it('rejeita desfecho fora do enum', () => {
    expect(DesfechoSchema.safeParse({ ...base, desfecho: 'talvez' }).success).toBe(false);
  });
  it('aceita tarefa com data null', () => {
    const r = DesfechoSchema.safeParse({ ...base, tarefas: [{ descricao: 'Ligar depois', data: null }] });
    expect(r.success).toBe(true);
  });
  it('aceita motivo_perda como MotivoTag no perdeu', () => {
    const r = DesfechoSchema.safeParse({ ...base, desfecho: 'perdeu', motivo_perda: 'concorrente', reabordar_em: '2027-01-01T12:00:00.000Z' });
    expect(r.success).toBe(true);
  });
  it('rejeita objecao inválida', () => {
    expect(DesfechoSchema.safeParse({ ...base, objecoes: ['preco'] }).success).toBe(false);
  });
});
