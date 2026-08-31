/**
 * POST   /api/roadmap/[itemId]/vote — "eu também preciso disso".
 * DELETE /api/roadmap/[itemId]/vote — tira o voto.
 *
 * O voto NÃO decide nada sozinho: serve para a Thalita ver o que dói em mais de
 * uma pessoa antes de aprovar. Quem aprova continua sendo admin.
 *
 * Um voto por pessoa por item é a chave primária de `roadmap_votes` — por isso
 * votar duas vezes devolve o mesmo 200 em vez de erro: do ponto de vista de
 * quem clicou, o estado desejado ("meu voto está lá") foi alcançado nas duas.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Código do Postgres para violação de chave única/PK. */
const PG_UNIQUE_VIOLATION = '23505';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
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

    const { error } = await supabase
      .from('roadmap_votes')
      .insert({ item_id: itemId, user_id: user.id });

    if (error && error.code !== PG_UNIQUE_VIOLATION) {
      console.error('[roadmap] voto falhou:', error.message);
      return NextResponse.json({ error: 'Não foi possível votar.' }, { status: 500 });
    }

    return NextResponse.json({ votei: true });
  } catch (e) {
    console.error('[roadmap] POST vote explodiu:', e);
    return NextResponse.json({ error: 'Não foi possível votar.' }, { status: 500 });
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

    const { error } = await supabase
      .from('roadmap_votes')
      .delete()
      .eq('item_id', itemId)
      .eq('user_id', user.id);

    if (error) {
      console.error('[roadmap] tirar voto falhou:', error.message);
      return NextResponse.json({ error: 'Não foi possível tirar o voto.' }, { status: 500 });
    }

    return NextResponse.json({ votei: false });
  } catch (e) {
    console.error('[roadmap] DELETE vote explodiu:', e);
    return NextResponse.json({ error: 'Não foi possível tirar o voto.' }, { status: 500 });
  }
}
