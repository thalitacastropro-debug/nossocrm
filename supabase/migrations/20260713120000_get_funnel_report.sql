-- =============================================================================
-- get_funnel_report: relatório do funil (grupos A-F do spec áudio→CRM §4.8)
-- em JSONB. Molde: get_messaging_metrics (auth via profiles/auth.uid(),
-- clamp de 365 dias, SECURITY DEFINER).
--
-- Grupos cobertos nesta versão (deriváveis dos dados já capturados):
--   volume:      agendadas / realizadas / vendas / perdidas
--   conversao:   show_rate (realizadas/agendadas), close_rate (vendas/realizadas)
--   receita:     total fechado (deals.value dos is_won) + vidas fechadas
--   diagnostico: motivos de perda (custom_fields.motivo_perda.categoria) +
--                objeções (custom_fields.objecoes[].categoria) agregados
-- =============================================================================

CREATE OR REPLACE FUNCTION get_funnel_report(
  p_org_id UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ DEFAULT NOW(),
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_agendadas INT;
  v_realizadas INT;
  v_vendas INT;
  v_perdidas INT;
  v_receita NUMERIC;
  v_vidas INT;
BEGIN
  -- Autorização: só membros da org.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Clamp: no máximo 365 dias pra trás.
  v_start := GREATEST(p_start, NOW() - INTERVAL '365 days');

  -- A. Volume — reuniões agendadas (CALL) e realizadas (CALL/MEETING completed).
  SELECT COUNT(*) INTO v_agendadas
  FROM activities a
  WHERE a.organization_id = p_org_id
    AND a.type = 'CALL'
    AND a.deleted_at IS NULL
    AND a.date BETWEEN v_start AND p_end
    AND (p_user_id IS NULL OR a.owner_id = p_user_id);

  SELECT COUNT(*) INTO v_realizadas
  FROM activities a
  WHERE a.organization_id = p_org_id
    AND a.type IN ('CALL', 'MEETING')
    AND a.completed = true
    AND a.deleted_at IS NULL
    AND a.date BETWEEN v_start AND p_end
    AND (p_user_id IS NULL OR a.owner_id = p_user_id);

  -- A/D. Vendas + receita + vidas (deals ganhos fechados no período).
  SELECT COUNT(*),
         COALESCE(SUM(d.value), 0),
         COALESCE(SUM(NULLIF(d.custom_fields->'qualificacao'->>'vidas', '')::INT), 0)
    INTO v_vendas, v_receita, v_vidas
  FROM deals d
  WHERE d.organization_id = p_org_id
    AND d.is_won = true
    AND d.deleted_at IS NULL
    AND d.closed_at BETWEEN v_start AND p_end
    AND (p_user_id IS NULL OR d.owner_id = p_user_id);

  SELECT COUNT(*) INTO v_perdidas
  FROM deals d
  WHERE d.organization_id = p_org_id
    AND d.is_lost = true
    AND d.deleted_at IS NULL
    AND d.closed_at BETWEEN v_start AND p_end
    AND (p_user_id IS NULL OR d.owner_id = p_user_id);

  RETURN jsonb_build_object(
    'volume', jsonb_build_object(
      'agendadas', v_agendadas,
      'realizadas', v_realizadas,
      'vendas', v_vendas,
      'perdidas', v_perdidas
    ),
    'conversao', jsonb_build_object(
      'show_rate', CASE WHEN v_agendadas > 0 THEN ROUND(v_realizadas::NUMERIC / v_agendadas, 3) ELSE 0 END,
      'close_rate', CASE WHEN v_realizadas > 0 THEN ROUND(v_vendas::NUMERIC / v_realizadas, 3) ELSE 0 END
    ),
    'receita', jsonb_build_object(
      'total', v_receita,
      'vidas', v_vidas
    ),
    'diagnostico', jsonb_build_object(
      'motivos_perda', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT d.custom_fields->'motivo_perda'->>'categoria' AS motivo, COUNT(*) AS n
          FROM deals d
          WHERE d.organization_id = p_org_id
            AND d.is_lost = true
            AND d.deleted_at IS NULL
            AND d.closed_at BETWEEN v_start AND p_end
            AND d.custom_fields->'motivo_perda'->>'categoria' IS NOT NULL
            AND (p_user_id IS NULL OR d.owner_id = p_user_id)
          GROUP BY 1 ORDER BY 2 DESC
        ) t
      ),
      'objecoes', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT obj->>'categoria' AS categoria, COUNT(*) AS n
          FROM deals d,
               jsonb_array_elements(
                 CASE WHEN jsonb_typeof(d.custom_fields->'objecoes') = 'array'
                      THEN d.custom_fields->'objecoes' ELSE '[]'::jsonb END
               ) AS obj
          WHERE d.organization_id = p_org_id
            AND d.deleted_at IS NULL
            AND d.updated_at BETWEEN v_start AND p_end
            AND jsonb_typeof(obj) = 'object'
            AND obj->>'categoria' IS NOT NULL
            AND (p_user_id IS NULL OR d.owner_id = p_user_id)
          GROUP BY 1 ORDER BY 2 DESC
        ) t
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_funnel_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
