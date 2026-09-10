import { describe, it, expect } from 'vitest';
import { pracaSemComercializacao, PRACAS_SEM_COMERCIALIZACAO } from './pracas-sem-comercializacao';

describe('praças sem comercialização', () => {
  it('reconhece a praça com e sem UF, com e sem acento, em qualquer caixa', () => {
    for (const escrita of ['Ourinhos-SP', 'Ourinhos', 'ourinhos sp', 'OURINHOS/SP', ' ourinhos ']) {
      expect(pracaSemComercializacao(escrita)?.praca).toBe('Ourinhos');
    }
  });

  it('não casa cidade que só CONTÉM o nome como pedaço de palavra', () => {
    // Se casasse por substring, "Ourinhos" pegaria qualquer coisa que o contenha.
    expect(pracaSemComercializacao('Ourinhoslândia')).toBeNull();
  });

  it('não casa a mesma cidade em UF diferente', () => {
    // A praça é (cidade, UF). Homônima em outro estado é outra praça, e pode ter
    // comercialização — bloquear seria inventar um "não" que ninguém verificou.
    expect(pracaSemComercializacao('Ourinhos-PR')).toBeNull();
  });

  it('deixa passar quem não está na lista, inclusive vazio e nulo', () => {
    for (const livre of ['São Paulo', 'Brasília', 'Guarulhos', '', null, 'desconhecido']) {
      expect(pracaSemComercializacao(livre)).toBeNull();
    }
  });

  it('toda entrada da lista tem a data e o motivo de como foi descoberta', () => {
    // A lista cresce por descoberta na cotação, uma praça por vez. Sem a
    // procedência ninguém sabe se ainda vale nem quem checou.
    for (const p of PRACAS_SEM_COMERCIALIZACAO) {
      expect(p.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.como.length).toBeGreaterThan(10);
    }
  });
});
