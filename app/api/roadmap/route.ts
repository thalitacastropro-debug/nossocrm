/**
 * GET  /api/roadmap  — o mural de melhorias do time, agrupado por etapa.
 * POST /api/roadmap  — qualquer colaborador sugere uma melhoria.
 *
 * Pedido da Thalita em 31/08/2026: *"um roadmap onde os colaboradores podem ir
 * colocando as melhorias que eles acham que deveria ter, e o que já foi
 * aprovado, o que já foi feito"*. Antes disso toda melhoria chegava por
 * WhatsApp e morria no scroll — o Pedro pediu telefone no card e o Denilson
 * pediu som de mensagem nova sem ter onde registrar nem como acompanhar.
 *
 * ESTAS ROTAS SÃO FINAS DE PROPÓSITO: quem decide o que pode é a RLS
 * (`20260831120000_roadmap_colaborativo.sql`), não o código daqui. Sugerir é de
 * todo mundo; mudar de etapa é só de admin; o autor congela o próprio texto
 * quando a sugestão sai da fila. Usamos o client do CALLER (nunca service role)
 * exatamente para que essas regras valham — a rota não é a defesa, é a porta.
 *
 * O único trabalho de servidor real aqui é juntar os votos e os nomes: o
 * PostgREST não faz `count` agregado por linha em embed, e mandar `profiles`
 * inteiro para o cliente exporia e-mail de quem não precisa aparecer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  ROADMAP_STATUS,
  type RoadmapStatus,
  type RoadmapItem,
} from '@/lib/roadmap/types';

export const maxDuration = 30;

const TITULO_MAX = 140;
const DESCRICAO_MAX = 4000;
const AREA_MAX = 40;

interface ItemRow {
  id: string;
  title: string;
  description: string | null;
  area: string | null;
  status: string;
  created_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

interface PerfilRow {
  id: string;
  name: string | null;
  nickname: string | null;
  first_name: string | null;
}

/** Mesma ordem de preferência do dropdown do time (useOrgMembersQuery). */
const nomeDe = (p: PerfilRow | null | undefined): string =>
  p ? p.nickname || p.name || p.first_name || 'Sem nome' : 'Alguém do time';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    // Sem filtro de organização aqui: a policy de select já recorta por
    // `minha_org()`. Repetir o filtro no código só criaria uma segunda verdade.
    const { data: itensRaw, error } = await supabase
      .from('roadmap_items')
      .select('id, title, description, area, status, created_by, decided_by, decided_at, decision_note, created_at, updated_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[roadmap] leitura falhou:', error.message);
      return NextResponse.json({ error: 'Não foi possível carregar o roadmap.' }, { status: 500 });
    }

    const itens = (itensRaw ?? []) as ItemRow[];
    if (itens.length === 0) return NextResponse.json({ itens: [] as RoadmapItem[] });

    const ids = itens.map((i) => i.id);
    const { data: votosRaw } = await supabase
      .from('roadmap_votes')
      .select('item_id, user_id')
      .in('item_id', ids);
    const votos = (votosRaw ?? []) as Array<{ item_id: string; user_id: string }>;

    const totalPorItem = new Map<string, number>();
    const meusVotos = new Set<string>();
    for (const v of votos) {
      totalPorItem.set(v.item_id, (totalPorItem.get(v.item_id) ?? 0) + 1);
      if (v.user_id === user.id) meusVotos.add(v.item_id);
    }

    const pessoaIds = [
      ...new Set(itens.flatMap((i) => [i.created_by, i.decided_by]).filter((v): v is string => !!v)),
    ];
    const { data: perfisRaw } = pessoaIds.length
      ? await supabase.from('profiles').select('id, name, nickname, first_name').in('id', pessoaIds)
      : { data: [] as PerfilRow[] };
    const perfis = new Map(((perfisRaw ?? []) as PerfilRow[]).map((p) => [p.id, p]));

    const saida: RoadmapItem[] = itens.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      area: i.area,
      status: (ROADMAP_STATUS as readonly string[]).includes(i.status)
        ? (i.status as RoadmapStatus)
        : 'sugerido',
      autor: nomeDe(perfis.get(i.created_by ?? '')),
      souOAutor: i.created_by === user.id,
      decididoPor: i.decided_by ? nomeDe(perfis.get(i.decided_by)) : null,
      decididoEm: i.decided_at,
      decisao: i.decision_note,
      votos: totalPorItem.get(i.id) ?? 0,
      votei: meusVotos.has(i.id),
      criadoEm: i.created_at,
      atualizadoEm: i.updated_at,
    }));

    return NextResponse.json({ itens: saida });
  } catch (e) {
    console.error('[roadmap] GET explodiu:', e);
    return NextResponse.json({ error: 'Não foi possível carregar o roadmap.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      description?: unknown;
      area?: unknown;
    } | null;

    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) return NextResponse.json({ error: 'Escreva o que você quer melhorar.' }, { status: 400 });
    if (title.length > TITULO_MAX) {
      return NextResponse.json({ error: `O título passou de ${TITULO_MAX} caracteres.` }, { status: 400 });
    }

    const description =
      typeof body?.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, DESCRICAO_MAX)
        : null;
    const area =
      typeof body?.area === 'string' && body.area.trim()
        ? body.area.trim().slice(0, AREA_MAX)
        : null;

    // `organization_id` sai do perfil de quem está pedindo — não do corpo da
    // requisição. Aceitar do cliente deixaria alguém plantar sugestão na
    // organização de outro; a policy barraria, mas o erro seria opaco.
    const { data: perfilRaw } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();
    const orgId = (perfilRaw as { organization_id: string | null } | null)?.organization_id;
    if (!orgId) {
      return NextResponse.json({ error: 'Perfil sem organização. Fale com o administrador.' }, { status: 403 });
    }

    // `status` fica no default 'sugerido': ninguém nasce aprovado, nem por
    // engano nem de propósito (a policy de insert exige isso também).
    const { data: criado, error } = await supabase
      .from('roadmap_items')
      .insert({ organization_id: orgId, title, description, area, created_by: user.id })
      .select('id')
      .single();

    if (error) {
      console.error('[roadmap] insert falhou:', error.message);
      return NextResponse.json({ error: 'Não foi possível registrar a sugestão.' }, { status: 500 });
    }

    return NextResponse.json({ id: (criado as { id: string }).id }, { status: 201 });
  } catch (e) {
    console.error('[roadmap] POST explodiu:', e);
    return NextResponse.json({ error: 'Não foi possível registrar a sugestão.' }, { status: 500 });
  }
}
