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
