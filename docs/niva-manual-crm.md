# Manual do CRM — Niva Consultoria
> Guia operacional personalizado para corretores de planos de saúde  
> Versão 1.0 — Maio/2026

---

## Sumário

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Os 5 Boards e Suas Funções](#2-os-5-boards-e-suas-funções)
3. [Fluxo Completo de um Lead](#3-fluxo-completo-de-um-lead)
4. [Critérios de Prioridade (MQLs)](#4-critérios-de-prioridade-mqls)
5. [O Que a IA Faz vs O Que o Consultor Faz](#5-o-que-a-ia-faz-vs-o-que-o-consultor-faz)
6. [Metas e KPIs por Board](#6-metas-e-kpis-por-board)
7. [Atividades Padrão](#7-atividades-padrão)
8. [Stella — Sua Assistente no Telegram](#8-stella--sua-assistente-no-telegram)
9. [Scripts de Referência Rápida](#9-scripts-de-referência-rápida)
10. [Glossário](#10-glossário)

---

## 1. Visão Geral do Sistema

O CRM da Niva Consultoria foi configurado para refletir o **método comercial consultivo** praticado pela equipe. O sistema organiza toda a jornada do lead — desde o primeiro contato até a renovação anual — em cinco boards conectados.

### Princípios do sistema

- **Nenhum lead é descartado permanentemente.** Todo lead que não converteu hoje entra em nutrição para ser abordado novamente no momento certo.
- **A IA opera, o consultor decide.** A inteligência artificial cuida das etapas operacionais e repetitivas. O consultor humano entra nas etapas que exigem relacionamento e julgamento.
- **Valor do deal = valor do plano.** O campo "Valor" em cada cartão representa o prêmio mensal que o cliente paga (ou pagará) no plano de saúde — não a comissão da corretora.

### Sócios e metas individuais

| Sócio | Meta mensal | Fechamentos necessários |
|-------|-------------|------------------------|
| Thalita Castro | R$ 20.000 | ~4 vendas/mês |
| Denilson | R$ 12.000 | ~3 vendas/mês |
| **Total empresa** | **R$ 35.360** (inclui operacional) | **~7 vendas/mês** |

> **Ticket médio:** R$ 2.000/mês (valor do plano)  
> **Prêmio médio por venda:** R$ 5.400 (calculado com 270% de comissão média)

---

## 2. Os 5 Boards e Suas Funções

### Board 1 — SDR: Prospecção
**Quem opera:** IA (SDR IA)  
**Objetivo:** Qualificar leads e agendar a 1ª visita com o consultor

| Etapa | O que significa | Ação esperada |
|-------|----------------|---------------|
| Novo Lead | Lead chegou, ainda não abordado | IA inicia abordagem |
| Tentativa de Contato | Ligação realizada, não conectou | IA reagenda tentativa |
| Contatado | Falou com o lead | IA aplica NAPA e tenta agendar |
| Agendado ✓ | 1ª visita marcada | Lead passa para Board 2 |
| Descartado | Não passou no filtro NAPA | Lead vai para Board 5 (Nutrição) |

---

### Board 2 — Comercial: Consultor
**Quem opera:** Consultor humano (Thalita / Denilson)  
**Objetivo:** Converter leads qualificados em clientes

| Etapa | O que significa | Ação esperada |
|-------|----------------|---------------|
| Call Agendada | Lead vindo do SDR com visita marcada | Consultor confirma e se prepara |
| Qualificação | 1ª visita realizada, diagnóstico em andamento | Consultor aplica 3 Sims e fecha parciais |
| Negociação | Proposta apresentada, tratando objeções | Consultor trata mín. 5 objeções |
| Em Potencial 🔥 | Lead quente, decisão iminente | Acompanhamento próximo |
| Fechado — Ganho ✓ | Plano contratado | Lead vai para Board 3 (Implantação) |
| Perdido | Não fechou | Lead vai para Board 5 (Nutrição) |

> ⚠️ **No Show:** Se o lead não apareceu na call agendada, o cartão volta para o SDR na etapa "Contatado" para reagendamento.

---

### Board 3 — Implantação: ADM
**Quem opera:** IA (Assistente ADM) + equipe administrativa  
**Objetivo:** Implantar o plano em até 15 dias úteis após o fechamento

| Etapa | O que significa | SLA |
|-------|----------------|-----|
| Aguardando Documentação | Solicitando docs ao cliente | 48h para envio |
| Em Análise | Documentação enviada à operadora | 5–10 dias úteis |
| Aviso Prévio | Operadora confirmou, aguardando início | 1–5 dias |
| Implantação Concluída ✓ | Plano ativo | Cliente vai para Board 4 |
| Cancelado | Implantação não concluída | Registrar motivo |

---

### Board 4 — Clientes Ativos (CS)
**Quem opera:** IA (CS IA — Agente de Sucesso) com escalonamento humano  
**Objetivo:** Manter ≥ 90% de retenção na renovação anual. NPS médio ≥ 70.

| Etapa | Período | O que a IA faz |
|-------|---------|----------------|
| Onboarding (D+1 a D+30) | Primeiros 30 dias | Boas-vindas D+1, check D+7, 1º NPS D+30 |
| Acompanhamento Ativo | D+30 a D+180 | Check trimestral, coleta de NPS D+90 |
| NPS Realizado ✓ | Após D+90 | Registra pontuação, solicita indicação se NPS ≥ 8 |
| Revisão Semestral (D+180) | 6 meses | Revisa cobertura, identifica necessidade de ajuste |
| Pré-Renovação (D+330) | 35 dias antes do aniversário | Alerta de renovação, prepara proposta de manutenção |
| Renovado ✓ | Renovação confirmada | Reinicia ciclo de CS |
| Cancelado | Cliente saiu | Registrar motivo, considerar reativação em 6 meses |

> ⚠️ **Importante:** Não existe upsell ou mudança de plano fora do aniversário da apólice. Qualquer alteração fora dessa janela gera multa contratual.

---

### Board 5 — Nutrição: Reativação
**Quem opera:** IA (Agente de Reativação)  
**Objetivo:** Reativar leads perdidos. A carteira é eterna — nenhum lead é descartado definitivamente.

| Etapa | O que significa | Ação da IA |
|-------|----------------|-----------|
| Aguardando Reabertura | Lead recém descartado, aguardando timing | Inicia nutrição após 30 dias |
| Em Reaquecimento | Sequência de conteúdo ativa | Mensagens de valor sobre planos |
| Recontato Agendado | Lead demonstrou interesse novamente | IA agenda com consultor |
| Reativado ✓ | Lead volta ao Board 2 (Comercial) | Consultor retoma |
| Em Hibernação 🌙 | Lead pausou (tem plano recém contratado, não é momento) | IA reativa no aniversário da apólice anterior |

---

## 3. Fluxo Completo de um Lead

```
[Anúncio Meta / Indicação / Lista Fria]
           ↓
    Board 1 — SDR
    IA qualifica pelo NAPA
           ↓
    Agendado ✓
           ↓
    Board 2 — Comercial
    Consultor faz diagnóstico (1ª Visita)
    Elabora proposta
    Apresenta (2ª Visita)
    Trata objeções
           ↓
   ┌───────┴──────┐
Fechado          Perdido
   ↓                ↓
Board 3         Board 5
Implantação     Nutrição
   ↓                ↓
Board 4        (quando reativar)
Clientes         Board 2
Ativos           Comercial
   ↓
Renovação anual → reinicia CS
```

---

## 4. Critérios de Prioridade (MQLs)

### O que é um MQL para a Niva Consultoria
MQL = Marketing Qualified Lead = lead com perfil para virar cliente.

| Critério | Alta 🔴 | Média 🟡 | Baixa ⚪ |
|----------|---------|---------|---------|
| CNPJ | Ativo ✓ | Ativo ✓ ou prof. liberal | Sem CNPJ |
| Vidas | 3+ | 2 (com limitações) | 1 |
| Valor do plano atual | ≥ R$ 2.000/mês | R$ 800–2.000 | < R$ 800 |
| Faixa etária | Todas até 67 anos | Alguma vida 68+ | Maioria 68+ |
| Plano atual | Identificado | Identificado | Desconhecido |
| Coparticipação | Identificada | Identificada | Não sabe |

### Padrão Ouro 🏅 — Lead de Alta Atenção

Lead que combina **família de 3–4 vidas** pagando **acima de R$ 5.000/mês** no plano atual.
Esse perfil indica poder aquisitivo elevado e ticket potencial acima da média — prioridade máxima de atendimento.

| Critério | Padrão Ouro |
|----------|-------------|
| Número de vidas | 3 a 4 pessoas |
| Valor atual do plano | > R$ 5.000/mês |
| Perfil esperado | Família de empresário ou profissional liberal |
| Ação | Consultor assume pessoalmente — não deixar apenas para IA finalizar |

### Comissões por operadora (referência)

| Operadora | Comissão | Prêmio em ticket médio (R$2.000) |
|-----------|---------|----------------------------------|
| Porto Seguro | 250% | R$ 5.000 |
| AMIL | 260% | R$ 5.200 |
| Sulamérica | 250% | R$ 5.000 |
| Alice | 220% | R$ 4.400 |
| **Bradesco** | **330%** | **R$ 6.600** |
| **Média** | **262%** | **R$ 5.240** |

---

## 5. O Que a IA Faz vs O Que o Consultor Faz

| Tarefa | IA | Consultor |
|--------|-----|-----------|
| Primeira abordagem ao lead frio | ✅ | |
| Qualificação NAPA | ✅ | |
| Agendamento da 1ª visita | ✅ | |
| Diagnóstico (1ª Visita) | | ✅ |
| Elaboração da proposta | | ✅ |
| Apresentação da proposta (2ª Visita) | | ✅ |
| Tratamento de objeções | | ✅ |
| Fechamento | | ✅ |
| Gestão de documentação | ✅ | |
| Checkpoints de CS (D+1, D+7, D+30...) | ✅ | |
| NPS automático | ✅ | |
| Alerta de renovação | ✅ | |
| Nutrição de leads perdidos | ✅ | |
| Decisões sobre mudança de plano | | ✅ |
| Relacionamento estratégico | | ✅ |
| Solicitação de indicações (momento NPS) | ✅ | |

---

## 6. Metas e KPIs por Board

### Funil completo (meta de sobrevivência — 7 vendas/mês)

| Board | KPI | Meta mínima | Meta saudável |
|-------|-----|------------|---------------|
| SDR | Agendamentos confirmados/mês | 39 | 50 |
| Comercial | Fechamentos/mês | 7 | 11 |
| Implantação | Implantações concluídas/mês | 7 | 11 |
| Clientes Ativos | Renovações/carteira (%) | 85% | 90% |
| Nutrição | Reativados → Agendados/mês | 2 | 4 |

### Funil reverso — o que precisa acontecer para 7 fechamentos

| Etapa | Volume necessário/mês |
|-------|----------------------|
| Ligações discadas (SDR) | ~290 (15/dia) |
| Conectados | ~130 |
| Agendamentos confirmados | 39 |
| 1ªs visitas realizadas | ~29 |
| Em negociação | ~23 |
| **Fechamentos** | **7** |

---

## 7. Atividades Padrão

O CRM registra quatro tipos de atividade:

| Ícone | Tipo | Cor no calendário | Quando usar |
|-------|------|-------------------|-------------|
| 📞 | CALL (Ligação) | Azul | Abordagem SDR, follow-up telefônico |
| 👥 | MEETING (Reunião) | Roxo | 1ª visita, 2ª visita, apresentação de proposta |
| ✉️ | EMAIL | Verde | Envio de proposta por email, follow-up escrito |
| ✅ | TASK (Tarefa) | Laranja | Elaborar proposta, enviar documentação, tarefa interna |

### Cadência padrão de atividades por deal

```
Novo Lead → Ligação de abordagem (CALL)
          → Se não atender: 3 tentativas em 3 dias
          → Se agendar: Reunião de diagnóstico (MEETING)
          → Após diagnóstico: Tarefa "Elaborar proposta" (TASK)
          → Apresentação da proposta (MEETING)
          → Follow-up pós-proposta (CALL)
          → Fechamento ou Nutrição
```

---

## 8. Stella — Sua Assistente no Telegram

A **Stella** é o bot do CRM no Telegram. Ela **envia notificações para você** sobre o que acontece no negócio.

### O que a Stella notifica hoje
- 🔔 **Handoff de IA:** quando um lead precisa de atenção humana (a IA não conseguiu avançar sozinha)
- 🔗 Link direto para o deal no CRM

### O que está sendo configurado (em breve)
- 📊 **Resumo diário (8h):** deals do dia, agendamentos, metas vs realizado
- ⚠️ **Alertas de NPS baixo:** cliente CS com pontuação < 7 → escalonamento imediato
- 📅 **Lembretes de follow-up:** deals parados há mais de 3 dias sem atividade

### Como a Stella funciona
Stella **envia, não responde.** Para consultar dados do CRM, acesse diretamente pelo navegador. Para receber o resumo do dia, a Stella manda automaticamente às 8h nos dias úteis.

---

## 9. Scripts de Referência Rápida

### Ligação de Abordagem — Lead Frio (Formulário)
> *"Alô, [Nome]? A gente não se conhece ainda — aqui quem fala é a Thalita da Niva Consultoria. Vi que você preencheu um formulário sobre revisão de plano de saúde. Tem dois minutos? O intuito da minha ligação é só marcar uma conversa rápida de 20–30 minutos, onde vamos entender melhor o seu momento atual. Fica melhor segunda às 10 ou quarta às 15?"*

### Ligação de Abordagem — Lead por Indicação
> *"Alô, [Nome]? A gente não se conhece — aqui é a Thalita da Niva Consultoria. Quem me passou seu contato foi [Fulano], que é cliente nosso. Você tem dois minutos? Quero marcar uma análise do seu plano de saúde, sem compromisso, sem custo. Fica melhor segunda ou terça?"*

### Tratamento de Objeções na Ligação

| Objeção | Resposta |
|---------|---------|
| "Manda cotação no WhatsApp" | "Meu trabalho é consultivo — não consigo passar cotação sem entender sua situação. Assim como um médico não dá diagnóstico sem consultar o paciente." |
| "Já tenho plano" | "Ótimo! Justamente quem tem plano há anos precisa de análise — pode estar pagando caro sem saber." |
| "Não tenho tempo" | "São 30 minutos da sua semana. Podemos fazer online, após as 18h, na sua casa." |
| "Não lembro de ter preenchido" | "Normal! De qualquer forma, o interesse surgiu por algum motivo. São só 20 minutos — segunda às 10 ou terça às 14?" |

### Solicitação de Indicação (ao final de toda reunião)
> *"Você conhece algum empresário ou profissional que também poderia se beneficiar desse tipo de análise? Meu trabalho cresce por indicação de pessoas como você, e sempre trato indicados com prioridade."*

---

## 10. Glossário

| Termo | Significado |
|-------|------------|
| **MQL** | Marketing Qualified Lead — lead com perfil para virar cliente |
| **NAPA** | Framework de qualificação: Necessidade, Acessibilidade, Poder de pagamento, Aceitação |
| **Ticket médio** | Valor médio do plano que o cliente paga mensalmente (R$ 2.000) |
| **Prêmio** | Comissão recebida pela corretora ao fechar o plano (% × valor do plano) |
| **Eleição forçada** | Técnica de agendamento: dar duas opções ao lead, nunca perguntar aberto |
| **3 Sims** | Técnica da 1ª visita: obter 3 respostas afirmativas antes de apresentar solução |
| **Fechamentos parciais** | Micro-comprometimentos durante a reunião para avançar o lead gradualmente |
| **No Show** | Lead agendou mas não apareceu na reunião |
| **Handoff** | Momento em que a IA transfere o lead para o consultor humano |
| **NPS** | Net Promoter Score — nota de satisfação do cliente (0–10) |
| **Aniversário da apólice** | Data de renovação anual do plano — única janela para ajustes sem multa |
| **Em Hibernação** | Lead pausado temporariamente na Nutrição — será reativado no aniversário da apólice |
| **SDR** | Sales Development Representative — responsável pela prospecção e agendamento |
| **CS** | Customer Success — gestão do cliente após a venda |
| **Board** | Coluna de pipeline no CRM — representa uma fase do processo |
| **Deal** | Cartão de negociação — representa um lead/cliente no CRM |
| **Stella** | Bot do Telegram da Niva Consultoria — envia notificações do CRM |

---

*Manual gerado em 26/05/2026 — Niva Consultoria / NossoCRM*  
*Atualizar sempre que houver mudança nos boards, etapas ou processos.*
