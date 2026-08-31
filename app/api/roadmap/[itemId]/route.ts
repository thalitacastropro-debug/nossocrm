/**
 * PATCH  /api/roadmap/[itemId] — move de etapa (admin) ou corrige o texto (autor).
 * DELETE /api/roadmap/[itemId] — apaga de vez (admin).
 *
 * Rota fina de novo: quem separa "admin move" de "autor corrige" é a RLS
 * (`roadmap_items_update_admin` e `roadmap_items_update_autor` na migração
 * 20260831120000). Aqui só validamos formato e traduzimos o silêncio da RLS —
 * um update barrado pelo Postgres volta com 0 linhas e SEM erro, e sem o
 * `.select()` abaixo a tela mostraria "salvo" para uma escrita que não
 * aconteceu. Foi o mesmo modo de falha do move entre funis, em 26/08.
 *
 * O carimbo de quem decidiu e quando é do TRIGGER, não daqui: a etapa também
 * muda por SQL na mão em incidente, e carimbo que só existe na rota mente
 * exatamente nessas horas.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isRoadmapStatus } from '@/lib/roadmap/types';

export const maxDuration = 30;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TITULO_MAX = 140;
const DESCRICAO_MAX = 4000;
const AREA_MAX = 40;
const DECISAO_MAX = 1000;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  if (!itemId || !uuidRegex.test(itemId)) {
    return NextResponse.json({ error: 'Item inválido.' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
      title?: unknown;
      description?: unknown;
      area?: unknown;
      decisao?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 });

    const patch: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!isRoadmapStatus(body.status)) {
        return NextResponse.json({ error: 'Etapa desconhecida.' }, { status: 400 });
      }
      patch.status = body.status;
    }

    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return NextResponse.json({ error: 'O título não pode ficar vazio.' }, { status: 400 });
      if (title.length > TITULO_MAX) {
        return NextResponse.json({ error: `O título passou de ${TITULO_MAX} caracteres.` }, { status: 400 });
      }
      patch.title = title;
    }

    if (body.description !== undefined) {
      patch.description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim().slice(0, DESCRICAO_MAX)
          : null;
    }

    if (body.area !== undefined) {
      patch.area =
        typeof body.area === 'string' && body.area.trim() ? body.area.trim().slice(0, AREA_MAX) : null;
    }

    if (body.decisao !== undefined) {
      patch.decision_note =
        typeof body.decisao === 'string' && body.decisao.trim()
          ? body.decisao.trim().slice(0, DECISAO_MAX)
          : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 });
    }

    // Recusar sem motivo é o que faz o time parar de sugerir. Exigimos aqui
    // porque é regra de produto, não de integridade — o banco aceita null.
    if (patch.status === 'recusado' && !patch.decision_note) {
      const { data: atual } = await supabase
        .from('roadmap_items')
        .select('decision_note')
        .eq('id', itemId)
        .maybeSingle();
      const jaTinha = (atual as { decision_note: string | null } | null)?.decision_note;
      if (!jaTinha) {
        return NextResponse.json(
          { error: 'Escreva o motivo antes de recusar — quem sugeriu precisa entender a decisão.' },
          { status: 400 },
        );
      }
    }

    const { data: salvo, error } = await supabase
      .from('roadmap_items')
      .update(patch)
      .eq('id', itemId)
      .is('deleted_at', null)
      .select('id, status')
      .maybeSingle();

    if (error) {
      console.error('[roadmap] update falhou:', error.message);
      return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 });
    }

    // 0 linhas = a RLS barrou (ou o item sumiu). É o caso de um vendedor
    // tentando mover de etapa, ou do autor editando algo que já foi decidido.
    if (!salvo) {
      return NextResponse.json(
        { error: 'Você não pode alterar este item. Mover de etapa é só do administrador, e o texto congela quando a sugestão sai da fila.' },
        { status: 403 },
      );
    }

    return NextResponse.json({ id: (salvo as { id: string }).id, status: (salvo as { status: string }).status });
  } catch (e) {
    console.error('[roadmap] PATCH explodiu:', e);
    return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  if (!itemId || !uuidRegex.test(itemId)) {
    return NextResponse.json({ error: 'Item inválido.' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const { data: apagado, error } = await supabase
      .from('roadmap_items')
      .delete()
      .eq('id', itemId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[roadmap] delete falhou:', error.message);
      return NextResponse.json({ error: 'Não foi possível apagar.' }, { status: 500 });
    }
    if (!apagado) {
      return NextResponse.json({ error: 'Só o administrador apaga item do roadmap.' }, { status: 403 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[roadmap] DELETE explodiu:', e);
    return NextResponse.json({ error: 'Não foi possível apagar.' }, { status: 500 });
  }
}
