import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LossReasonModal } from '@/components/ui/LossReasonModal';
import { MOTIVO_TAGS, MOTIVO_LABELS } from '@/lib/ai/taxonomy/motivos';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

const base = {
  isOpen: true,
  onClose: () => {},
  onConfirm: () => {},
  dealTitle: 'Fulano — Lead Meta Ads',
};

/**
 * O motivo da perda virou obrigatório e estruturado em 09/09/2026 (decisão da Thalita), porque em
 * produção só **1 dos 36** perdidos tinha motivo: os atalhos eram texto livre e havia um botão
 * "Pular esta etapa" que gravava "Não informado".
 */
describe('LossReasonModal — motivo obrigatório e estruturado', () => {
  it('oferece TODOS os motivos da taxonomia única (não uma lista paralela)', () => {
    const out = html(<LossReasonModal {...base} />);
    for (const tag of MOTIVO_TAGS) {
      expect(out).toContain(MOTIVO_LABELS[tag]);
    }
  });

  it('não tem mais o "Pular esta etapa" — era ele que produzia "Não informado"', () => {
    const out = html(<LossReasonModal {...base} />);
    expect(out).not.toContain('Pular esta etapa');
    expect(out).not.toContain('Não informado');
  });

  it('confirmar nasce desabilitado: sem motivo escolhido não dá pra marcar perdido', () => {
    const out = html(<LossReasonModal {...base} />);
    // Isola a tag do botão de submit e exige o `disabled` NELA — asserir "disabled aparece no
    // HTML" passaria por acidente se qualquer outro elemento viesse desabilitado.
    const submit = out.match(/<button[^>]*type="submit"[^>]*>/);
    expect(submit).not.toBeNull();
    expect(submit![0]).toContain('disabled');
    expect(out).toContain('Confirmar perda');
  });

  it('não abre nada quando isOpen=false', () => {
    expect(html(<LossReasonModal {...base} isOpen={false} />)).toBe('');
  });

  it('some com os atalhos de texto livre antigos (viravam motivo não-agregável)', () => {
    const out = html(<LossReasonModal {...base} />);
    expect(out).not.toContain('Preço muito alto');
    expect(out).not.toContain('Perdeu para concorrente');
    expect(out).not.toContain('Momento inadequado');
    expect(out).not.toContain('Cliente desistiu');
  });

  it('mostra o título do negócio pra quem está marcando saber o que está perdendo', () => {
    const out = html(<LossReasonModal {...base} />);
    expect(out).toContain('Fulano — Lead Meta Ads');
  });
});
