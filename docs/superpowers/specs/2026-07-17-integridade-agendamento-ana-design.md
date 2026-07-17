# Integridade do agendamento da Ana — falso aceite, guard que tranca, feriados, 2 horários

> Design fechado com a Thalita em 2026-07-17, disparado por um bug ao vivo (Nathalia).
> **Pré-requisito da cadência 3** (`2026-07-17-followup-cadencia3-antinoshow-design.md`): o
> lembrete anuncia pro lead o horário que estiver marcado. Megafone antes de consertar a boca
> só faz o erro chegar mais longe.
> Branch: `feat/lead-intake-route`.

## 1. O incidente que originou este spec

Lead Nathalia (deal `9b1afb1c`), 17/07. Horários em BRT (banco grava UTC):

| Hora | Evento |
|---|---|
| 8h22:44 | Ana: "Consigo te encaixar hoje ainda, sexta às 11h, 13h ou 14h?" |
| 8h22:51 | Lead: **"Mas eu só vou poder atender no final da tarde"** |
| 8h22:53 | 🔴 sistema marca **sexta 17h** (`criada_em` bate aqui) |
| 8h22:54 | Ana: "Consigo te encaixar hoje à tarde então, sexta às 15h, 16h ou 17h, qual fica melhor?" |
| 8h23:19 | Lead: "Hoje meu dia está complicado. Pode ser na segunda?" |
| 8h23:51 | Lead: "15" |
| 8h23:55 | Ana: "Perfeito, então **segunda às 15h** com o consultor." |

Resultado: a Ana prometeu segunda 15h; o calendário do Denilson ficou com sexta 17h. Corrigido à
mão no banco em 17/07 11h (activity + JSON, com o shape do booker).

### 1.1 Causa A — falso aceite

`detect.ts:69` pede ao LLM a intenção da última mensagem do lead. **"Só vou poder atender no final
da tarde" é uma RESTRIÇÃO, não um aceite** — mas virou `accept` + slot 17h (o "final da tarde" da
lista). `validateDetectedSlot` (`detect.ts:23`) **não protege**: ele só valida que o horário existe
entre os ofertados — trava contra horário *inventado*, não contra *intenção mal lida*. 17h existia.

O system prompt já cobre vagueza ("qualquer um", "pode ser" ⇒ `none`) mas **não cobre restrição de
período**. A armadilha é a restrição que casa com exatamente um slot: "final da tarde" ⇒ 17h.

### 1.2 Causa B — o guard tranca o erro

`scheduling.service.ts:86-91`: com reunião confirmada, um `accept` posterior **retorna o label
antigo sem re-marcar**. Quando a lead disse "15", o serviço reafirmou sexta 17h internamente; a Ana,
gerando texto livre, escreveu "segunda às 15h" porque era o que a conversa pedia. **A fala e o banco
divergiram.**

O guard não é gratuito — o comentário `81-85` explica: sem ele, cada mensagem re-agendava e o
horário deslizava 9h→10h. Ele resolveu aquilo e criou isto: **não distingue "reconfirmando a mesma
reunião" de "aceitando um horário NOVO depois de pedir outro dia"**.

### 1.3 Por que o conserto óbvio não serve

"Só reafirma se `detect.slotIso` for o horário já marcado" **reabre o 9h→10h**. Motivo:
`busy.ts:26-33` carrega todas as activities do consultor — inclusive a reunião do próprio lead — e
`getAvailableSlots` exclui o que está busy. **O horário marcado NÃO está na lista de ofertados.**
Com a instrução "slotIso DEVE ser exatamente um dos oferecidos" (`detect.ts:18,69`), o LLM é
*forçado* a apontar outro horário quando o lead só reconfirma. Comparar slots sem consertar a lista
faria toda reconfirmação virar remarcação.

## 2. Fix A — restrição de período ⇒ `none`

Acrescentar ao system prompt do `detectSchedulingIntent` (`detect.ts:68-69`):

> Se o lead expressa apenas uma RESTRIÇÃO ou PREFERÊNCIA de período ("só de tarde", "só depois das
> 15h", "de manhã", "pode ser na segunda?", "essa semana não") **sem escolher um horário concreto da
> lista**, use `none` — **mesmo que só um dos horários oferecidos caiba na restrição**. Escolher
> por ele é erro: quem escolhe é o lead. `accept` exige que o lead aponte um horário.

A cláusula final é a que pega o caso real: "final da tarde" casava com exatamente um slot (17h), e
foi por isso que o detector se sentiu autorizado a decidir.

Efeito no fluxo: "pode ser na segunda?" ⇒ `none` ⇒ a Ana oferta horários de segunda ⇒ lead escolhe
⇒ `accept` ⇒ marca. É o que a conversa já fazia — só sem marcar errado no meio.

## 3. Fix B — re-injetar o horário marcado + comparar slot

Duas mudanças em `scheduling.service.ts`:

1. **Detecção enxerga o horário já marcado.** Passar pro `detectSchedulingIntent` a lista
   `available + slotDaReuniaoMarcada` (reconstruído de `reuniaoAgendada.data_hora` + `label`, ou
   `slotLabelFromIso`). **Só para a detecção** — `context.available_slots` continua = `available`,
   senão a Ana ofereceria de volta um horário que já é do próprio lead.
2. **O short-circuit passa a comparar o slot**, não só a intenção:

```ts
// Reafirma SÓ se o lead está reconfirmando O MESMO horário. Se apontou outro, é remarcação
// de fato — mesmo que o detector tenha rotulado 'accept' (ele rotula pela frase (\"15\"), não
// pelo estado). Sem o item 1, isto reabriria o 9h→10h: o horário marcado não estaria na lista
// e o detector seria forçado a apontar outro.
if (alreadyBooked && detect.intent === 'accept' && mesmoSlot(detect.slotIso, reuniaoAgendada.data_hora)) {
  return { available, status: { kind: 'confirmed', label }, detected: detect };
}
```

`mesmoSlot` compara no minuto, reusando a tolerância de `validateDetectedSlot` (`detect.ts:27`).

Caindo fora do short-circuit, o fluxo existente já faz o certo: `validateDetectedSlot` contra
`available`, `bookSlot` com `previousActivityId` (cancela a antiga, cria a nova) — a linha 105 já
passa o `previousActivityId` em `reschedule`; **estender para o `accept` que mudou de slot**.

### 3.1 Cenários (os dois têm que passar)

| Cenário | Lista pro detector | `slotIso` | Marcado | Ação |
|---|---|---|---|---|
| Reconfirmação (9h→10h) | `[9h(marcado), 10h, 11h…]` | 9h | 9h | **reafirma**, não re-marca ✓ |
| Nathalia | `[sex 17h(marcado), seg 13h, 14h, 15h]` | seg 15h | sex 17h | **re-marca** seg 15h ✓ |
| Reconfirmação vaga ("ok!") | idem | null | — | `none`, nada acontece ✓ |

## 4. Fix C — feriados nacionais

Hoje `availability.ts:56` (`dow >= 1 && dow <= 5`) é a **única** noção de dia útil do sistema.
Verificado: rodando o `getAvailableSlots` real com `now` = 03/09/2026, a lista oferta
**"segunda, 07/09, às 9h"** — Independência. A Ana marca e o Denilson não trabalha ⇒ no-show
causado pelo sistema. Com a cadência 3 no ar, ela ainda *reconfirmaria* a reunião fantasma.

**Escopo: só feriado NACIONAL, em código.** Sem tabela, sem UI, sem migration.
`lib/ai/scheduling/holidays.ts`:

- Fixos: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11, 25/12.
- Móveis, derivados da Páscoa (algoritmo de Meeus/Butcher, ~10 linhas, puro): Carnaval (−47),
  Sexta-feira Santa (−2), Corpus Christi (+60).
- `isFeriado(year, month, day): boolean` — comparação em data SP, sem I/O.

**Bloqueio de data pessoal do consultor NÃO entra**: ele já funciona hoje — o Denilson cria uma
activity no dia e o `loadBusyIntervals` (`busy.ts:26-33`) a trata como ocupado. Não construir o que
já existe.

Aplicar em dois lugares:
1. `availability.ts:56` ⇒ `isBusinessDay = dow >= 1 && dow <= 5 && !isFeriado(...)` — não oferta.
2. `ultimoDiaUtilAntes` da cadência 3 (§4.3 do outro spec) ⇒ recua também em feriado, para a
   véspera não cair num dia em que ninguém lê.

**Fora de escopo:** o gate do cron (`route.ts:18`) continua `daysOfWeek [1..5]`. Inofensivo: se a
Ana não marca em feriado, não há reunião naquele dia pra lembrar; e os toques das cadências 1/2 num
feriado não fazem mal (lead lê WhatsApp em feriado).

## 5. Fix D — 2 horários por vez

`context-builder.ts:482`: `'Ofereça 2–3 por vez, não a lista toda.'` ⇒ **`'Ofereça exatamente 2 por
vez, nunca 3 ou mais, e nunca a lista toda.'`**

Não é persona no banco — é código. Confirmado ao vivo: a Ana ofertou 3 nas três vezes ("11h, 13h ou
14h" · "15h, 16h ou 17h" · "13h, 14h ou 15h").

## 6. Testes

**Fix A** (`test/scheduling/detect.test.ts`, mock do LLM não serve — o defeito É o julgamento do
LLM). Testar o determinístico e registrar o resto como validação ao vivo:
- `validateDetectedSlot` continua rejeitando horário fora da lista (regressão).
- A avaliação da qualidade do prompt vai pro `ana-tuning-log.md` + observação nos próximos leads.

**Fix B** (puro, o grosso — `test/scheduling/booker.test.ts` já tem molde de deps):
- `mesmoSlot(iso, data_hora)`: igual no minuto ⇒ true; 1h de diferença ⇒ false; null ⇒ false.
- reconfirmação: marcado 9h + `slotIso` 9h + `accept` ⇒ **não** chama `bookSlot` (regressão 9h→10h).
- Nathalia: marcado sex 17h + `slotIso` seg 15h + `accept` ⇒ chama `bookSlot` **com**
  `previousActivityId` = activity de sexta.
- a lista passada ao detector contém o slot marcado; `context.available_slots` **não** contém.

**Fix C** (puro):
- `isFeriado` p/ 07/09/2026, 25/12/2026, 01/01/2027 ⇒ true; 08/09/2026 ⇒ false.
- Páscoa 2026 = 05/04 ⇒ Carnaval 17/02, Sexta Santa 03/04, Corpus Christi 04/06.
- regressão do bug real: `getAvailableSlots` com `now` = 03/09/2026 **não** oferta 07/09.
- `ultimoDiaUtilAntes(terça 08/09 9h)` ⇒ sexta 04/09 17h (pula 07/09 feriado **e** o fim de semana).

**Fix D**: sem teste automatizado (é texto de prompt); validar ao vivo no próximo lead.

## 7. Arquivos

Novos: `lib/ai/scheduling/holidays.ts`, `test/scheduling/holidays.test.ts`.
Tocados: `lib/ai/scheduling/detect.ts` (prompt + export de `mesmoSlot`),
`lib/ai/scheduling/scheduling.service.ts` (re-injeção + short-circuit + `previousActivityId` no
accept-que-mudou), `lib/ai/scheduling/availability.ts` (`isBusinessDay`),
`lib/ai/agent/context-builder.ts:482` (2 horários).

## 8. Não entra aqui (registrado)

- **Tier `indefinido` bloqueando o selo** — descoberto no mesmo diagnóstico: o card da Nathalia tem
  `tier.value='indefinido'`, motivo *"Faltam CNPJ e/ou número de vidas"*, mas ela deu 2 vidas (form)
  e "São Paulo" (localização). Pela regra da Niva — CNPJ = **localização**, não o número — era
  classificável. É bug da lógica do tier, não falta de qualificação. Vale sessão própria junto dos
  outros itens de card (selo no agendado, layout, borda).
- Leads agendados não irem pro funil do corretor · barra de "objetivo" sem contabilizar
  agendamentos · layout do card aberto mostrar data/hora.
- Destravar o `cancel` da Ana fora do board dela (`scheduling.service.ts:45-48`).
