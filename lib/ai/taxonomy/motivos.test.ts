import { describe, it, expect } from 'vitest';
import { MotivoTagSchema, MOTIVO_LABELS, MOTIVO_TAGS } from './motivos';

describe('MotivoTag taxonomy', () => {
  it('aceita todas as tags válidas', () => {
    for (const tag of MOTIVO_TAGS) expect(MotivoTagSchema.safeParse(tag).success).toBe(true);
  });
  it('rejeita "preco" (mapeado para sem_oportunidade)', () => {
    expect(MotivoTagSchema.safeParse('preco').success).toBe(false);
  });
  it('tem rótulo pt-BR para cada tag', () => {
    for (const tag of MOTIVO_TAGS) expect(MOTIVO_LABELS[tag]).toBeTruthy();
  });
});

// Praça sem comercialização (09/09). Nasceu do caso Gabriel Fernandes (Ourinhos-SP): o consultor
// descartou escrevendo à mão "Não há comercialização na cidade do lead." porque NENHUMA das 14
// tags servia. `fora_icp` é coisa diferente (sem CNPJ/inelegível) — aqui o lead é elegível, quem
// não atende é a operadora. Sem a tag própria, o motivo virava "Outro" e sumia do relatório.
describe('fora_da_area', () => {
  it('é uma tag válida da taxonomia', () => {
    expect(MotivoTagSchema.safeParse('fora_da_area').success).toBe(true);
    expect(MOTIVO_TAGS).toContain('fora_da_area');
  });
  it('tem rótulo próprio, distinto de "Fora do ICP"', () => {
    expect(MOTIVO_LABELS.fora_da_area).toBe('Fora da área de comercialização');
    expect(MOTIVO_LABELS.fora_da_area).not.toBe(MOTIVO_LABELS.fora_icp);
  });
});
