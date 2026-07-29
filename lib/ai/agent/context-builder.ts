/**
 * @fileoverview Lead Context Builder
 *
 * Monta o contexto completo do lead para o AI Agent.
 * Coleta dados do CRM, histórico de mensagens e informações do deal.
 *
 * @module lib/ai/agent/context-builder
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadContext } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Número máximo de mensagens a incluir no contexto */
const MAX_MESSAGES_IN_CONTEXT = 20;

// =============================================================================
// Context Builder
// =============================================================================

export interface BuildContextParams {
  supabase: SupabaseClient;
  conversationId: string;
  organizationId: string;
}

/**
 * Monta o contexto completo do lead para o AI Agent.
 *
 * Inclui:
 * - Dados do contato
 * - Deal associado (se houver)
 * - Histórico de mensagens
 * - Estatísticas da conversa
 */
export async function buildLeadContext(
  params: BuildContextParams
): Promise<LeadContext | null> {
  const { supabase, conversationId, organizationId } = params;

  // 1. Buscar conversa com dados relacionados
  const { data: conversation, error: convError } = await supabase
    .from('messaging_conversations')
    .select(`
      id,
      contact_id,
      external_contact_name,
      message_count,
      created_at,
      last_message_at,
      metadata,
      channel:messaging_channels!inner(
        id,
        name,
        organization_id
      )
    `)
    .eq('id', conversationId)
    .single();

  if (convError || !conversation) {
    console.error('[ContextBuilder] Conversation not found:', convError);
    return null;
  }

  // 2. Parallelizar queries independentes após obter conversation
  const dealId = (conversation.metadata as Record<string, unknown>)?.deal_id as string | undefined;

  const [contactResult, dealResult, messagesResult, orgResult] = await Promise.all([
    // 2a. Buscar contato (se vinculado)
    conversation.contact_id
      ? supabase
          .from('contacts')
          .select('id, name, email, phone, company_name, role, notes')
          .eq('id', conversation.contact_id)
          .single()
      : Promise.resolve({ data: null }),

    // 2b. Buscar deal associado via metadata
    dealId
      ? supabase
          .from('deals')
          .select(`
            id,
            title,
            value,
            ai_summary,
            created_at,
            custom_fields,
            stage:board_stages!inner(
              id,
              name
            )
          `)
          .eq('id', dealId)
          .single()
      : Promise.resolve({ data: null }),

    // 2c. Buscar histórico de mensagens
    supabase
      .from('messaging_messages')
      .select('direction, content, created_at, metadata')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MAX_MESSAGES_IN_CONTEXT),

    // 2d. Buscar organização
    supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single(),
  ]);

  // 3. Processar contato
  let contact: LeadContext['contact'] = null;
  if (contactResult.data) {
    const contactData = contactResult.data;
    contact = {
      id: contactData.id,
      name: contactData.name,
      email: contactData.email,
      phone: contactData.phone,
      company: contactData.company_name,
      position: contactData.role,
    };
  }

  // Se não tem contato vinculado, usar dados da conversa
  if (!contact) {
    contact = {
      id: conversationId,
      name: conversation.external_contact_name,
      email: null,
      phone: null,
      company: null,
      position: null,
    };
  }

  // 4. Processar deal
  let deal: LeadContext['deal'] = null;
  if (dealResult.data) {
    const dealData = dealResult.data;
    const stageData = dealData.stage as unknown as { id: string; name: string } | null;
    deal = {
      id: dealData.id,
      title: dealData.title,
      value: dealData.value,
      stage_id: stageData?.id || '',
      stage_name: stageData?.name || 'Sem estágio',
      notes: dealData.ai_summary,
      created_at: dealData.created_at,
    };
  }

  // 4b. Extrair o formulário de entrada (lead_form) do deal, se houver.
  // A intake route grava o form em deals.custom_fields.lead_form (ver app/api/public/v1/leads/route.ts).
  // Expomos só mapped + fields (o útil); raw e first_touch são ruído/controle interno.
  let leadForm: LeadContext['lead_form'] = null;
  let qualificacao: LeadContext['qualificacao'] = null;
  let reuniaoAgendada: LeadContext['reuniao_agendada'] = null;
  let tier: LeadContext['tier'] = null;
  if (dealResult.data) {
    const customFields = (dealResult.data as { custom_fields?: Record<string, unknown> }).custom_fields;
    const lf = customFields?.lead_form as Record<string, unknown> | undefined;
    if (lf && typeof lf === 'object') {
      const mapped = lf.mapped as { name?: string | null; email?: string | null; phone?: string | null } | undefined;
      leadForm = {
        source: typeof lf.source === 'string' ? lf.source : null,
        received_at: typeof lf.received_at === 'string' ? lf.received_at : null,
        mapped: mapped
          ? { name: mapped.name ?? null, email: mapped.email ?? null, phone: mapped.phone ?? null }
          : null,
        fields: lf.fields && typeof lf.fields === 'object' ? (lf.fields as Record<string, unknown>) : null,
      };
    }
    // Campos que a Ana já coletou/extraiu na conversa (preserva o que já se sabe → não re-perguntar).
    const qual = customFields?.qualificacao as Record<string, unknown> | undefined;
    if (qual && typeof qual === 'object' && Object.keys(qual).length > 0) {
      qualificacao = qual;
    }
    // Tier/ICP já classificado (do turno anterior — extração é async). Backstop de gate + escalação.
    const tierField = customFields?.tier as { value?: unknown } | undefined;
    if (tierField && typeof tierField.value === 'string') {
      tier = tierField.value;
    }
    // Reunião já agendada (agenda real) — o wiring usa activity_id/status pra remarcar/cancelar.
    const ra = customFields?.reuniao_agendada as Record<string, unknown> | undefined;
    if (ra && typeof ra === 'object') {
      reuniaoAgendada = {
        activity_id: typeof ra.activity_id === 'string' ? ra.activity_id : undefined,
        status: typeof ra.status === 'string' ? ra.status : undefined,
        data_hora: typeof ra.data_hora === 'string' ? ra.data_hora : undefined,
      };
    }
  }

  // 5. Buscar stage config (depende do deal) — sequencial
  let stage: LeadContext['stage'];
  if (deal) {
    const { data: stageConfig } = await supabase
      .from('stage_ai_config')
      .select('stage_goal, advancement_criteria')
      .eq('stage_id', deal.stage_id)
      .single();

    stage = {
      id: deal.stage_id,
      name: deal.stage_name,
      goal: stageConfig?.stage_goal || null,
      advancement_criteria: (stageConfig?.advancement_criteria as string[]) || [],
    };
  } else {
    stage = {
      id: '',
      name: 'Novo Lead',
      goal: 'Qualificar interesse e coletar informações básicas',
      advancement_criteria: [],
    };
  }

  // 6. Processar mensagens
  const messages: LeadContext['messages'] = (messagesResult.data || [])
    .reverse()
    .map((msg) => {
      const metadata = msg.metadata as Record<string, unknown> | null;
      const isAI = metadata?.sent_by_ai === true;

      return {
        role: msg.direction === 'inbound' ? 'lead' : isAI ? 'agent' : 'human',
        content: extractTextContent(msg.content as Record<string, unknown>),
        timestamp: msg.created_at,
      };
    });

  const aiMessagesCount = messages.filter((m) => m.role === 'agent').length;

  const orgData = orgResult.data;

  // 8. Montar contexto final
  const context: LeadContext = {
    contact,
    deal,
    lead_form: leadForm,
    qualificacao,
    tier,
    reuniao_agendada: reuniaoAgendada,
    stage,
    messages,
    organization: {
      name: orgData?.name || 'Empresa',
    },
    stats: {
      total_messages: conversation.message_count || messages.length,
      ai_messages_count: aiMessagesCount,
      conversation_started_at: conversation.created_at,
      last_message_at: conversation.last_message_at || conversation.created_at,
    },
  };

  return context;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extrai texto do conteúdo da mensagem.
 */
function extractTextContent(content: Record<string, unknown>): string {
  if (typeof content === 'string') {
    return content;
  }

  // Formato padrão: { type: 'text', text: '...' }
  if (content.text && typeof content.text === 'string') {
    return content.text;
  }

  // Fallback para outros tipos
  if (content.type === 'image') {
    return '[Imagem]';
  }
  if (content.type === 'audio') {
    return '[Áudio]';
  }
  if (content.type === 'video') {
    return '[Vídeo]';
  }
  if (content.type === 'document') {
    return `[Documento: ${content.filename || 'arquivo'}]`;
  }

  return '[Mensagem]';
}

/** Converte um valor de campo do formulário em texto legível para o prompt. */
function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Arrays de valores (ex.: idades, objeções) ficam mais legíveis como "30, 35, 8" do que "[30,35,8]".
  if (Array.isArray(value)) {
    return value.map((v) => formatFieldValue(v)).join(', ');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Descreve o "agora" (data/hora no fuso da org + período do dia) para o prompt.
 * A Ana não tem noção de tempo por conta própria — sem isso ela ecoa o
 * cumprimento errado do lead (ex.: responde "bom dia" às 15h). Injeta o período
 * atual e manda cumprimentar de acordo, sem repetir o erro do lead.
 */
function describeNowBlock(timezone: string): string[] {
  const tz = timezone || 'America/Sao_Paulo';
  const now = new Date();
  const hourStr = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', hour12: false }).format(now);
  const hour = Number.parseInt(hourStr, 10);
  const dataLabel = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(now);
  const horaLabel = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);

  let periodo = 'manhã';
  let saudacao = 'bom dia';
  if (Number.isFinite(hour)) {
    if (hour >= 12 && hour < 18) { periodo = 'tarde'; saudacao = 'boa tarde'; }
    else if (hour >= 18 || hour < 5) { periodo = 'noite'; saudacao = 'boa noite'; }
  }

  return [
    '## Agora (ATENÇÃO AO HORÁRIO)',
    `Data e hora atuais: ${dataLabel}, ${horaLabel} — período da ${periodo}.`,
    `Cumprimente de acordo com o período ATUAL: "${saudacao}". Se o lead cumprimentar com o período errado (ex.: "bom dia" à tarde), NÃO repita o erro dele — responda com "${saudacao}" com naturalidade.`,
    '',
  ];
}

/**
 * Formata o contexto como texto para o prompt.
 */
export function formatContextForPrompt(
  context: LeadContext,
  options?: { timezone?: string | null }
): string {
  const lines: string[] = [];

  // Hora atual (para a Ana cumprimentar de acordo com o período do dia)
  lines.push(...describeNowBlock(options?.timezone || 'America/Sao_Paulo'));

  // Informações do lead
  lines.push('## Sobre o Lead');
  if (context.contact) {
    if (context.contact.name) lines.push(`Nome: ${context.contact.name}`);
    if (context.contact.email) lines.push(`Email: ${context.contact.email}`);
    if (context.contact.phone) lines.push(`Telefone: ${context.contact.phone}`);
    if (context.contact.company) lines.push(`Empresa: ${context.contact.company}`);
    if (context.contact.position) lines.push(`Cargo: ${context.contact.position}`);
  }
  lines.push('');

  // O QUE JÁ SABEMOS sobre o lead — bloco ÚNICO (formulário do Meta + o que já foi
  // coletado na conversa), com o MESMO vocabulário que a Ana deve coletar, pra ela não
  // re-perguntar. Antes vinham DOIS blocos com rótulos diferentes (chaves cruas do Meta
  // "Você possuí CNPJ?: sim" x labels de coleta), e o modelo não ligava um ao outro.
  // Precedência: a CONVERSA (qualificacao) VENCE o formulário (dado mais recente); o form
  // só preenche lacunas. Normalização conservadora: o valor fica como o lead informou —
  // nunca cravamos o enum de CNPJ (PME/MEI) a partir de um "sim" (isso é pendência do
  // consultor confirmar), evitando a Ana afirmar dado errado com confiança.
  {
    const QUAL_LABELS: Record<string, string> = {
      tem_cnpj: 'CNPJ',
      vidas: 'Vidas',
      idades: 'Idades',
      tem_plano_atual: 'Já tem plano',
      operadora: 'Operadora',
      valor_pago_exato: 'Valor que paga hoje',
      coparticipacao: 'Coparticipação',
      hospital_preferencia: 'Hospital de preferência',
      cidade_uf: 'Cidade/UF',
      reuniao_preferencia: 'Preferência para a ligação do consultor',
      algo_a_destacar: 'A destacar para o consultor',
    };
    // Chaves de controle/atribuição do Meta (não são qualificação → ruído no prompt).
    const FORM_NOISE = new Set([
      'anuncio', 'conjunto', 'campanha', 'channel_id', 'ad_id', 'adset_id', 'nome', 'email', 'telefone',
    ]);
    // Rótulo cru do formulário do Meta → label curto alinhado ao vocabulário de coleta.
    // Só normaliza em match de alta confiança; o resto cai no rótulo original (fallback).
    const labelForFormKey = (key: string): string | null => {
      const k = key.toLowerCase();
      if (k.includes('cnpj')) return 'CNPJ';
      if (k.includes('idade')) return 'Idades';
      if (k.includes('paga') || k.includes('valor')) return 'Valor que paga hoje';
      if (k.includes('plano de saúde') || k.includes('plano de saude') || k.includes('possui plano')) return 'Já tem plano';
      if (k.includes('hospital') || k.includes('rede credenciada')) return 'Hospital de preferência';
      if (k.includes('operadora')) return 'Operadora';
      return null;
    };

    const known: string[] = [];
    const seen = new Set<string>();

    const formName = context.lead_form?.mapped?.name;
    if (formName) {
      known.push(`Nome: ${formName}`);
      seen.add('Nome');
    }

    // 1) Conversa (autoritativa) primeiro.
    if (context.qualificacao) {
      for (const [key, value] of Object.entries(context.qualificacao)) {
        if (value === null || value === undefined || value === '') continue;
        if (Array.isArray(value) && value.length === 0) continue;
        const label = QUAL_LABELS[key] ?? key;
        if (seen.has(label)) continue;
        const rendered = key === 'valor_pago_exato' ? `R$ ${formatFieldValue(value)}` : formatFieldValue(value);
        known.push(`${label}: ${rendered}`);
        seen.add(label);
      }
    }

    // 2) Formulário do Meta preenche só as lacunas (valor cru; sem cravar enum de CNPJ).
    if (context.lead_form?.fields) {
      for (const [key, value] of Object.entries(context.lead_form.fields)) {
        if (value === null || value === undefined || value === '') continue;
        if (FORM_NOISE.has(key.toLowerCase())) continue;
        const label = labelForFormKey(key) ?? key;
        if (seen.has(label)) continue;
        known.push(`${label}: ${formatFieldValue(value)}`);
        seen.add(label);
      }
    }

    if (known.length > 0) {
      lines.push('## O QUE JÁ SABEMOS SOBRE O LEAD — NÃO PERGUNTE DE NOVO');
      lines.push(
        'Trate como FATO já informado (veio do formulário ou já foi dito na conversa). ' +
          'Pergunte SÓ o que NÃO está nesta lista. Se precisar validar, confirme de leve e UMA vez — ' +
          'nunca re-pergunte estes itens e NUNCA diga "você preencheu no formulário"/"você já falou isso"; apenas siga sabendo.'
      );
      known.forEach((e) => lines.push(`- ${e}`));
      lines.push('');
    }
  }

  // Deal
  if (context.deal) {
    lines.push('## Deal Atual');
    lines.push(`Título: ${context.deal.title}`);
    if (context.deal.value) lines.push(`Valor: R$ ${context.deal.value.toLocaleString('pt-BR')}`);
    lines.push(`Estágio: ${context.deal.stage_name}`);
    if (context.deal.notes) lines.push(`Notas: ${context.deal.notes}`);
    lines.push('');
  }

  // Objetivo do estágio
  lines.push('## Objetivo Atual');
  lines.push(`Estágio: ${context.stage.name}`);
  if (context.stage.goal) lines.push(`Meta: ${context.stage.goal}`);
  if (context.stage.advancement_criteria.length > 0) {
    lines.push('Critérios para avançar:');
    context.stage.advancement_criteria.forEach((c) => lines.push(`- ${c}`));
  }
  lines.push('');

  // Estatísticas
  lines.push('## Estatísticas');
  lines.push(`Total de mensagens: ${context.stats.total_messages}`);
  lines.push(`Mensagens do AI: ${context.stats.ai_messages_count}`);
  lines.push(`Conversa iniciada: ${new Date(context.stats.conversation_started_at).toLocaleDateString('pt-BR')}`);
  lines.push('');

  // Agenda real: horários disponíveis + status da reunião
  if (context.available_slots && context.available_slots.length > 0) {
    lines.push('## Horários disponíveis para a ligação do consultor');
    lines.push('Ofereça SOMENTE estes horários. NUNCA invente outro. Ofereça EXATAMENTE 2 por vez, nunca 3 ou mais, e nunca a lista toda.');
    lines.push('Se nenhum servir, diga que vai confirmar a melhor data com o consultor (não prometa fora da lista).');
    context.available_slots.forEach((s) => lines.push(`- ${s.label}`));
    lines.push('');
  }
  if (context.scheduling_status && context.scheduling_status.kind !== 'none') {
    lines.push('## Status da reunião');
    const st = context.scheduling_status;
    if (st.kind === 'confirmed') {
      lines.push(`REUNIÃO JÁ CONFIRMADA para ${st.label}. Confirme pro lead com naturalidade; o consultor liga nesse horário.`);
    } else if (st.kind === 'slot_taken') {
      const alts = st.alternatives.map((s) => s.label).join(' ou ');
      lines.push(`O horário que o lead pediu acabou de ser preenchido. Peça desculpa e ofereça: ${alts}.`);
    } else if (st.kind === 'cancelled') {
      lines.push('A reunião foi cancelada. NUNCA deixe solto: puxe um novo horário agora ou avise que o consultor reorganiza.');
    } else if (st.kind === 'declined') {
      lines.push('O lead RECUSOU os horários oferecidos. Acolha sem insistir e NÃO re-jogue os mesmos horários. Se ele só não pôde nesses, ofereça de leve outras opções da lista acima que você ainda não ofereceu. Se ele já recusou tudo ou não quer marcar agora, diga que o consultor vê a melhor data e te retorna aqui no WhatsApp, e encerre sua parte.');
    }
    lines.push('');
  }

  // Histórico
  lines.push('## Histórico da Conversa');
  context.messages.forEach((msg) => {
    const roleLabel = msg.role === 'lead' ? 'Lead' : msg.role === 'agent' ? 'AI' : 'Vendedor';
    const time = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    lines.push(`[${time}] ${roleLabel}: ${msg.content}`);
  });

  return lines.join('\n');
}
