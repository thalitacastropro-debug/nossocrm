/**
 * Testes para lib/ai/agent/output-validator.ts
 *
 * Verifica que respostas do LLM são validadas antes de serem enviadas ao lead:
 * - Vazamento de system prompt / identidade de IA
 * - Vazamento de PII do contexto
 * - Limite de tamanho (WhatsApp 4096 chars)
 * - Resposta vazia
 */
import { describe, expect, it, vi } from 'vitest'
import { validateAIOutput, BLOCKED_OUTPUT_BRIDGE } from '@/lib/ai/agent/output-validator'
import type { LeadContext } from '@/lib/ai/agent/types'

vi.mock('@/lib/ai/agent/structured-logger', () => ({
  logStructured: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Fixture de contexto mínimo
// ---------------------------------------------------------------------------
const EMPTY_CONTEXT: LeadContext = {
  deal: null,
  contact: null,
  stage: null,
  recentMessages: [],
  organization: null,
}

const CONTEXT_WITH_PII: LeadContext = {
  ...EMPTY_CONTEXT,
  contact: {
    id: 'c1',
    name: 'João Silva',
    email: 'joao@empresa.com.br',
    phone: '+5511999887766',
  } as any,
  deal: {
    id: 'd1',
    title: 'Proposta',
    value: 15000,
  } as any,
}

const FALLBACK = BLOCKED_OUTPUT_BRIDGE

// ---------------------------------------------------------------------------
// Respostas seguras — devem passar
// ---------------------------------------------------------------------------
describe('validateAIOutput — respostas seguras', () => {
  it('aprova resposta normal sem PII', () => {
    const result = validateAIOutput(
      'Olá! Posso ajudar com mais informações sobre nosso produto.',
      EMPTY_CONTEXT
    )
    expect(result.safe).toBe(true)
    expect(result.response).toBe('Olá! Posso ajudar com mais informações sobre nosso produto.')
    expect(result.issues).toHaveLength(0)
  })

  it('aprova resposta com nome genérico não PII', () => {
    const result = validateAIOutput(
      'Obrigado pelo interesse! Nossa equipe entrará em contato.',
      CONTEXT_WITH_PII
    )
    expect(result.safe).toBe(true)
  })

  it('aprova resposta longa mas dentro do limite de 4096', () => {
    const longResponse = 'A '.repeat(2000) // ~4000 chars
    const result = validateAIOutput(longResponse, EMPTY_CONTEXT)
    expect(result.safe).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Resposta vazia — deve usar fallback
// ---------------------------------------------------------------------------
describe('validateAIOutput — resposta vazia', () => {
  it('rejeita string vazia', () => {
    const result = validateAIOutput('', EMPTY_CONTEXT)
    expect(result.safe).toBe(false)
    expect(result.response).toBe(FALLBACK)
    expect(result.issues).toContain('empty_response')
  })

  it('rejeita string com apenas espaços', () => {
    const result = validateAIOutput('   ', EMPTY_CONTEXT)
    expect(result.safe).toBe(false)
    expect(result.issues).toContain('empty_response')
  })
})

// ---------------------------------------------------------------------------
// Limite de tamanho — deve usar fallback
// ---------------------------------------------------------------------------
describe('validateAIOutput — limite de tamanho', () => {
  it('rejeita resposta com mais de 4096 caracteres', () => {
    const tooLong = 'x'.repeat(4097)
    const result = validateAIOutput(tooLong, EMPTY_CONTEXT)
    expect(result.safe).toBe(false)
    expect(result.response).toBe(FALLBACK)
    expect(result.issues.some(i => i.startsWith('length_exceeded'))).toBe(true)
  })

  it('aprova resposta exatamente em 4096', () => {
    const exact = 'x'.repeat(4096)
    const result = validateAIOutput(exact, EMPTY_CONTEXT)
    expect(result.safe).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Vazamento de system prompt / identidade de IA
// ---------------------------------------------------------------------------
describe('validateAIOutput — vazamento de system prompt', () => {
  it('rejeita quando LLM revela identidade como IA (PT)', () => {
    const result = validateAIOutput(
      'Como uma IA, posso te ajudar com isso!',
      EMPTY_CONTEXT
    )
    expect(result.safe).toBe(false)
    expect(result.issues.some(i => i.includes('revealed_ai_identity_pt'))).toBe(true)
    expect(result.response).toBe(FALLBACK)
  })

  it('rejeita quando LLM declara ser IA (PT)', () => {
    const result = validateAIOutput('Sou um robô projetado para ajudar vendas.', EMPTY_CONTEXT)
    expect(result.safe).toBe(false)
    expect(result.issues.some(i => i.includes('declared_ai_pt'))).toBe(true)
  })

  it('rejeita quando LLM revela que foi programado', () => {
    const result = validateAIOutput(
      'Fui programado para responder apenas sobre nossos produtos.',
      EMPTY_CONTEXT
    )
    expect(result.safe).toBe(false)
    expect(result.issues.some(i => i.includes('revealed_programming_pt'))).toBe(true)
  })

  it('rejeita quando LLM vaza as regras do sistema', () => {
    const result = validateAIOutput(
      'REGRAS IMPORTANTES: nunca mencione preços.',
      EMPTY_CONTEXT
    )
    expect(result.safe).toBe(false)
    expect(result.issues.some(i => i.includes('rules_dump_pt'))).toBe(true)
  })

  it('rejeita quando LLM revela identidade como AI (EN)', () => {
    const result = validateAIOutput(
      'As an AI assistant, I can help you with that!',
      EMPTY_CONTEXT
    )
    expect(result.safe).toBe(false)
    expect(result.issues.some(i => i.includes('revealed_ai_identity_en'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Vazamento de PII
// ---------------------------------------------------------------------------
describe('validateAIOutput — vazamento de PII', () => {
  it('rejeita quando email do lead aparece na resposta', () => {
    const result = validateAIOutput(
      'Enviaremos a proposta para joao@empresa.com.br assim que possível.',
      CONTEXT_WITH_PII
    )
    expect(result.safe).toBe(false)
    expect(result.issues.some(i => i.startsWith('pii_leak:email'))).toBe(true)
  })

  it('rejeita quando número de telefone completo aparece na resposta', () => {
    const result = validateAIOutput(
      'Ligaremos para +5511999887766 em breve.',
      CONTEXT_WITH_PII
    )
    expect(result.safe).toBe(false)
    expect(result.issues.some(i => i.startsWith('pii_leak:phone'))).toBe(true)
  })

  // REGRESSÃO (26/08): `deals.value` guarda a MENSALIDADE QUE O LEAD PAGA — dado que ele mesmo
  // acabou de dizer no chat, não PII vinda do CRM. Tratar isso como vazamento destruiu 6 respostas
  // reais da Ana (Daniel R$500, Richard R$350, Ana Paula R$750, Domingos R$715, Lilian R$990).
  it('NÃO rejeita quando a Ana repete a mensalidade do lead (valor do deal)', () => {
    const result = validateAIOutput(
      'Nossa proposta de 15000 reais inclui suporte.',
      CONTEXT_WITH_PII
    )
    expect(result.safe).toBe(true)
    expect(result.issues.some(i => i.startsWith('pii_leak:deal_value'))).toBe(false)
  })

  it('caso Daniel (18/08): recap com "R$ 500" passa quando deal.value = 500', () => {
    const ctx: LeadContext = {
      ...EMPTY_CONTEXT,
      contact: { id: 'c1', name: 'Daniel', email: null, phone: '+5512991228329' } as any,
      deal: { id: 'd1', title: 'Daniel', value: 500 } as any,
    }
    const texto = 'Anotado: Unimed, R$ 500, sem coparticipação, 3 vidas.'
    const result = validateAIOutput(texto, ctx)
    expect(result.safe).toBe(true)
    expect(result.response).toBe(texto)
  })

  it('não rejeita quando PII não está no contexto', () => {
    const result = validateAIOutput(
      'Enviaremos a proposta para joao@empresa.com.br assim que possível.',
      EMPTY_CONTEXT // sem contact no contexto
    )
    expect(result.safe).toBe(true)
  })

  it('não rejeita número muito curto como PII (evita falso positivo)', () => {
    // deal.value = 150 (2 dígitos < 3) não deve triggar
    const ctx: LeadContext = {
      ...EMPTY_CONTEXT,
      deal: { id: 'd1', title: 'Proposta', value: 15 } as any,
    }
    const result = validateAIOutput('Temos 15 opções disponíveis.', ctx)
    expect(result.safe).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Estrutura do retorno
// ---------------------------------------------------------------------------
describe('validateAIOutput — estrutura do ValidationResult', () => {
  it('retorna campos corretos quando seguro', () => {
    const result = validateAIOutput('Olá!', EMPTY_CONTEXT)
    expect(result).toHaveProperty('safe', true)
    expect(result).toHaveProperty('response', 'Olá!')
    expect(result).toHaveProperty('issues')
    expect(Array.isArray(result.issues)).toBe(true)
  })

  it('retorna campos corretos quando não seguro', () => {
    const result = validateAIOutput('', EMPTY_CONTEXT)
    expect(result).toHaveProperty('safe', false)
    expect(result).toHaveProperty('response', FALLBACK)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// A mensagem de bloqueio NÃO pode encerrar a conversa
// ---------------------------------------------------------------------------
describe('mensagem usada quando a resposta é bloqueada', () => {
  it('é uma PONTE, não uma despedida', () => {
    const result = validateAIOutput('Sou um robô projetado para ajudar vendas.', EMPTY_CONTEXT)
    expect(result.safe).toBe(false)
    expect(result.response).toBe(BLOCKED_OUTPUT_BRIDGE)
    // O texto antigo se despedia e a conversa morria ali (6 casos reais desde 28/07).
    expect(result.response).not.toMatch(/retornar[áa] em breve|entrar[áa] em contato/i)
  })

  it('promete resposta da própria Ana, no mesmo canal', () => {
    expect(BLOCKED_OUTPUT_BRIDGE).toMatch(/j[áa] te respondo/i)
  })
})

// ---------------------------------------------------------------------------
// NARRAÇÃO INTERNA — a Ana pensando em voz alta na bolha do lead
//
// Três incidentes reais em produção, achados varrendo as 1726 mensagens que ela já enviou. Nenhum
// era vazamento de prompt: é português normal, endereçado à pessoa errada. Por isso nenhum dos
// padrões antigos pegava.
// ---------------------------------------------------------------------------
describe('narração interna não pode virar mensagem do lead', () => {
  /** As quatro bolhas reais, com data e destinatário. */
  const VAZAMENTOS_REAIS: Array<[string, string]> = [
    [
      'Richard Gois, 16/08',
      'No momento, você já fez a pergunta de abertura ("você tem plano de saúde hoje, ou seria o primeiro?") e o lead respondeu apenas com "Olá", sem responder à pergunta.',
    ],
    ['Richard Gois, 16/08 (bolha seguinte)', 'Relance a pergunta de forma leve e direta, sem repetir a introdução:'],
    ['Brooksfield, 21/09', 'Sem resposta ainda do lead sobre a imagem. Vou reengajar retomando de onde parou:'],
    ['Regina Balbino, 28/09', 'Aqui está o follow-up:'],
  ];

  it.each(VAZAMENTOS_REAIS)('bloqueia o vazamento de %s', (_quem, texto) => {
    const r = validateAIOutput(texto, EMPTY_CONTEXT)
    expect(r.safe).toBe(false)
    expect(r.response).toBe(FALLBACK)
    expect(r.issues.some((i) => i.startsWith('narracao:'))).toBe(true)
  })

  /**
   * O outro lado da trava, e o mais importante: ela não pode matar conversa boa.
   *
   * O "de onde paramos" é o exemplo que quase entrou como padrão — está no vazamento do
   * Brooksfield, mas a Ana usa a mesma expressão em follow-up legítimo, e são 3 casos reais.
   */
  const LEGITIMAS = [
    'Lay, ainda por aí? Podemos continuar de onde paramos.',
    'Adriane, ainda por aí? Podemos continuar de onde paramos.',
    'Oi Rafael, sou a Ana, da Niva.',
    'Qual é a operadora do seu plano hoje?',
    'A Niva trabalha com Porto, Amil, SulAmérica, Alice, Bradesco e MedSênior.',
    'Vi que você tem interesse em otimizar seu plano de saúde e que são 5 ou mais vidas, certo?',
    'Rafael, vou pausar por aqui. Quando quiser retomar, é só responder.',
    'Entendo, às vezes a galera quer saber as opções antes de falar da situação atual.',
    'Consigo terça às 10h ou quarta às 14h. Qual fica melhor?',
    'Perfeito! O consultor te liga nesse horário.',
    // As duas abaixo seriam bloqueadas pelo padrão de imperativo que eu tirei — ficam aqui como
    // trava para ele não voltar sem medir.
    'Confirme se entendi certo: são 5 vidas, você e mais quatro?',
    'Responda quando puder que eu sigo daqui.',
  ]

  it.each(LEGITIMAS)('deixa passar mensagem de verdade: %s', (texto) => {
    const r = validateAIOutput(texto, EMPTY_CONTEXT)
    expect(r.issues).toEqual([])
    expect(r.safe).toBe(true)
    expect(r.response).toBe(texto)
  })

  it('"lead" é a palavra que ela nunca diz — quem diz está falando DO lead, não COM ele', () => {
    const r = validateAIOutput('Vou confirmar os dados do lead e te retorno.', EMPTY_CONTEXT)
    expect(r.safe).toBe(false)
    expect(r.issues).toContain('narracao:fala_do_lead_em_terceira_pessoa')
  })

  it('anunciar sem entregar (termina em dois-pontos) é bloqueado', () => {
    const r = validateAIOutput('Segue a mensagem para o cliente:', EMPTY_CONTEXT)
    expect(r.safe).toBe(false)
    expect(r.issues).toContain('narracao:anuncia_e_nao_entrega')
  })

  it('a falha é MACIA: cai na ponte e o time é avisado, não some calada', () => {
    const r = validateAIOutput('Aqui está o follow-up:', EMPTY_CONTEXT)
    // `safe: false` é o gatilho do alarme no agent.service (Telegram + nota na timeline).
    expect(r.safe).toBe(false)
    expect(r.response).toBe(BLOCKED_OUTPUT_BRIDGE)
    expect(r.issues.length).toBeGreaterThan(0)
  })
})
