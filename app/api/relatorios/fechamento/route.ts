/**
 * GET /api/relatorios/fechamento?inicio=<ISO>&fim=<ISO> — fechamento do mês por pessoa.
 *
 * ADMIN-ONLY, sem exceção. Comissão e remuneração são dado confidencial: em 26/08/2026 o
 * `goal_description` do funil expôs pró-labore e comissão média para o time inteiro, e a
 * regra que ficou é "admin = quem pode ver o caixa" (Thalita e Denilson — decisão §4b do
 * niva-os-visao.md). Vendedor não recebe nem 403 explicativo demais: recebe "só para
 * administradores".
 *
 * A FONTE É O CARIMBO (`custom_fields.venda`), em TODOS os funis da organização — não um
 * funil por vez como `GET /api/boards/[boardId]/vendas`. O recorte de período é em JS pelo
 * mesmo motivo documentado lá (carimbo escrito à mão não pode sumir em silêncio).
 *
 * REGRAS DE COMISSÃO — decididas pela Thalita em 26/08 (roadmap §6c), aplicadas aqui no
 * servidor para nenhuma tabela de percentual viajar ao cliente de quem não deve ver:
 *
 * | situação                                        | regra                     | comissão      |
 * |-------------------------------------------------|---------------------------|---------------|
 * | colaborador TROUXE o cliente (carteira própria) | `colaborador_trouxe_140`  | 140% × prêmio |
 * | colaborador vende lead DA CASA (tráfego)        | `colaborador_casa_100`    | 100% × prêmio |
 * | carteira própria de SÓCIO (admin)               | `socio_carteira_cheia`    | null (¹)      |
 * | sócio vende lead da casa                        | `casa_sem_comissao`       | null          |
 * | carteira própria sem "quem trouxe"              | `indefinida`              | null (²)      |
 *
 * (¹) Comissão cheia da corretora = percentual POR OPERADORA — a tabela ainda está "a
 *     confirmar" com a Thalita (niva-os-visao.md §5). Número não confirmado não aparece:
 *     seria chute vestido de relatório.
 * (²) Sem saber quem trouxe, não dá para dizer nem a comissão nem se conta na meta
 *     (carteira de sócio fica FORA da meta; de colaborador, DENTRO). `conta_na_meta: null`
 *     é pendência de marcação na aba Origem do card.
 *
 * "Sócio" aqui = papel `admin` — é a mesma régua da decisão "quem pode ver o caixa", e é
 * por ela que a meta exclui a carteira da Thalita e do Denilson mas inclui a do Pedro.
 *
 * Venda SEM prêmio informado: a regra sai calculada, a comissão fica `null` e
 * `pendente_premio: true` — o número nasce quando alguém preencher o prêmio
 * (PATCH /api/deals/[dealId]/venda).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { lerPremioFechado } from '@/lib/deals/premioFechado';

export const maxDuration = 30;

/** Multiplicadores DECIDIDOS (26/08). A tabela por operadora NÃO entra até ser confirmada. */
const MULT_COLABORADOR_TROUXE = 1.4;
const MULT_COLABORADOR_CASA = 1.0;

type RegraDeComissao =
  | 'colaborador_trouxe_140'
  | 'colaborador_casa_100'
  | 'socio_carteira_cheia'
  | 'casa_sem_comissao'
  | 'indefinida';

interface PerfilRow {
  id: string;
  name: string | null;
  nickname: string | null;
  first_name: string | null;
  role: string | null;
}

interface LinhaDeVenda {
  id: string | null;
  title: string | null;
  value: number | null;
  venda: Record<string, unknown> | null;
  origem_comercial: Record<string, unknown> | null;
}

interface VendaDoFechamento {
  deal_id: string;
  titulo: string | null;
  board_id_da_venda: string | null;
  funil_da_venda: string | null;
  vendido_em: string;
  vendedor_id: string | null;
  vendedor_nome: string | null;
  premio_mensal: number | null;
  operadora: string | null;
  pendente_premio: boolean;
  /** 'trafego' | 'carteira_propria' — sem marcação, o padrão da casa é tráfego. */
  origem: 'trafego' | 'carteira_propria';
  regra: RegraDeComissao;
  /** A quem a comissão pertence (quem trouxe, na carteira; o vendedor, na casa). */
  pessoa_da_comissao_id: string | null;
  pessoa_da_comissao_nome: string | null;
  /** null = regra sem número (sócio/casa) ou prêmio pendente. */
  comissao: number | null;
  /** null = não dá para dizer (carteira sem "quem trouxe"). */
  conta_na_meta: boolean | null;
}

const texto = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.trim() !== '' ? valor : null;

const nomeDoPerfil = (p: PerfilRow | undefined): string | null =>
  p ? (p.nickname || p.name || p.first_name || null) : null;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const inicio = searchParams.get('inicio') ?? '';
  const fim = searchParams.get('fim') ?? '';
  const de = Date.parse(inicio);
  const ate = Date.parse(fim);
  if (!inicio || !fim || Number.isNaN(de) || Number.isNaN(ate) || de > ate) {
    return NextResponse.json({ error: 'Período inválido. Informe início e fim em formato ISO.' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const { data: perfilRaw } = await supabase
      .from('profiles')
      .select('id, role, organization_id')
      .eq('id', user.id)
      .single();
    const perfil = perfilRaw as { id: string; role: string | null; organization_id: string | null } | null;
    if (!perfil?.organization_id) {
      return NextResponse.json({ error: 'Perfil sem organização. Fale com o administrador.' }, { status: 403 });
    }
    // O gate: fechamento é caixa. `ve_todos_os_leads` NÃO basta — a decisão de 26/08 é
    // "admin = quem pode ver o financeiro", e ponto.
    if (perfil.role !== 'admin') {
      return NextResponse.json({ error: 'Relatório disponível só para administradores.' }, { status: 403 });
    }
    const orgId = perfil.organization_id;

    const admin = createStaticAdminClient();

    // Todos os cards carimbados da organização, em qualquer funil. `not('custom_fields->venda', 'is', null)`
    // corta no banco quem nunca teve venda; o recorte de período fica no JS (ver o topo).
    const { data, error } = await admin
      .from('deals')
      .select('id, title, value, venda:custom_fields->venda, origem_comercial:custom_fields->origem_comercial')
      .eq('organization_id', orgId)
      .not('custom_fields->venda', 'is', null)
      .is('deleted_at', null);
    if (error) {
      console.error('[relatorios/fechamento] varredura falhou:', error.message);
      return NextResponse.json({ error: 'Não foi possível carregar as vendas.' }, { status: 500 });
    }

    // O time inteiro de uma vez: papel (sócio x colaborador) e nome de exibição.
    const { data: perfisRaw, error: perfisErr } = await admin
      .from('profiles')
      .select('id, name, nickname, first_name, role')
      .eq('organization_id', orgId);
    if (perfisErr) {
      console.error('[relatorios/fechamento] leitura do time falhou:', perfisErr.message);
      return NextResponse.json({ error: 'Não foi possível carregar o time.' }, { status: 500 });
    }
    const time = new Map(((perfisRaw ?? []) as PerfilRow[]).map((p) => [p.id, p]));
    const ehSocio = (id: string | null): boolean => (id ? time.get(id)?.role === 'admin' : false);

    const linhas = (data ?? []) as unknown as LinhaDeVenda[];
    const vendas: VendaDoFechamento[] = [];
    let ignorados = 0;

    for (const linha of linhas) {
      const bruto = linha.venda;
      if (!linha.id || !bruto || typeof bruto !== 'object') {
        ignorados += 1;
        continue;
      }
      const vendidoEm = texto(bruto.vendido_em);
      if (!vendidoEm) {
        ignorados += 1;
        continue;
      }
      const quando = Date.parse(vendidoEm);
      if (Number.isNaN(quando)) {
        ignorados += 1;
        continue;
      }
      if (quando < de || quando > ate) continue;

      const vendedorId = texto(bruto.vendedor_id);
      const premio = lerPremioFechado(bruto);

      // Sem marcação na aba Origem, o lead É da casa: "todo lead que cai no CRM vem do
      // tráfego; os de carteira são adicionados manualmente" (Thalita, 26/08).
      const origemBruta = linha.origem_comercial;
      const ehCarteira =
        typeof origemBruta === 'object' && origemBruta !== null &&
        (origemBruta as Record<string, unknown>).tipo === 'carteira_propria';
      const quemTrouxe = ehCarteira
        ? texto((origemBruta as Record<string, unknown>).quem_trouxe)
        : null;

      let regra: RegraDeComissao;
      let pessoaId: string | null;
      let contaNaMeta: boolean | null;
      let multiplicador: number | null = null;

      if (ehCarteira) {
        if (!quemTrouxe) {
          // Sem "quem trouxe" não dá para aplicar regra nenhuma — nem meta (carteira de
          // sócio fica fora; de colaborador, dentro). Pendência de marcação, não chute.
          regra = 'indefinida';
          pessoaId = null;
          contaNaMeta = null;
        } else if (ehSocio(quemTrouxe)) {
          // Comissão cheia da corretora = percentual POR OPERADORA, ainda a confirmar
          // com a Thalita. Número não confirmado não sai daqui.
          regra = 'socio_carteira_cheia';
          pessoaId = quemTrouxe;
          contaNaMeta = false;
        } else {
          regra = 'colaborador_trouxe_140';
          pessoaId = quemTrouxe;
          contaNaMeta = true;
          multiplicador = MULT_COLABORADOR_TROUXE;
        }
      } else if (ehSocio(vendedorId)) {
        // Sócio fechando lead da casa: a receita é da casa; não existe comissão de pessoa.
        regra = 'casa_sem_comissao';
        pessoaId = vendedorId;
        contaNaMeta = true;
      } else {
        regra = 'colaborador_casa_100';
        pessoaId = vendedorId;
        contaNaMeta = true;
        multiplicador = MULT_COLABORADOR_CASA;
      }

      const comissao =
        premio !== null && multiplicador !== null
          ? Math.round(premio.premio_mensal * multiplicador * 100) / 100
          : null;

      vendas.push({
        deal_id: linha.id,
        titulo: texto(linha.title),
        board_id_da_venda: texto(bruto.board_id_da_venda),
        funil_da_venda: texto(bruto.funil_da_venda),
        vendido_em: vendidoEm,
        vendedor_id: vendedorId,
        vendedor_nome: texto(bruto.vendedor_nome) ?? nomeDoPerfil(vendedorId ? time.get(vendedorId) : undefined),
        premio_mensal: premio?.premio_mensal ?? null,
        operadora: premio?.operadora ?? null,
        pendente_premio: premio === null,
        origem: ehCarteira ? 'carteira_propria' : 'trafego',
        regra,
        pessoa_da_comissao_id: pessoaId,
        pessoa_da_comissao_nome: nomeDoPerfil(pessoaId ? time.get(pessoaId) : undefined),
        comissao,
        conta_na_meta: contaNaMeta,
      });
    }

    vendas.sort((a, b) => Date.parse(b.vendido_em) - Date.parse(a.vendido_em));

    if (ignorados > 0) {
      console.error(`[relatorios/fechamento] ${ignorados} carimbo(s) ilegível(is) na organização ${orgId}`);
    }

    // Agregados prontos: a tela agrupa por pessoa, mas os totais saem daqui para o número
    // do topo bater com a lista sem depender de JS da tela.
    let premioTotal = 0;
    let comissaoTotal = 0;
    let pendentesDePremio = 0;
    let vendasNaMeta = 0;
    for (const v of vendas) {
      if (v.premio_mensal !== null) premioTotal += v.premio_mensal;
      else pendentesDePremio += 1;
      if (v.comissao !== null) comissaoTotal += v.comissao;
      if (v.conta_na_meta === true) vendasNaMeta += 1;
    }

    return NextResponse.json(
      {
        inicio,
        fim,
        vendas,
        contagem: vendas.length,
        premioTotal,
        comissaoTotal,
        pendentesDePremio,
        vendasNaMeta,
        ignorados,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[relatorios/fechamento]', error instanceof Error ? error.message : 'Erro desconhecido');
    return NextResponse.json({ error: 'Erro interno ao montar o fechamento.' }, { status: 500 });
  }
}
