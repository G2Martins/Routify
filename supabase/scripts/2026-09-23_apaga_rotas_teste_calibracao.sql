-- Expurgo das rotas de teste da calibração de semáforo (ml/calibrate_signals.py),
-- rodada contra a API local em 2026-09-23 entre 04:12 e 05:15 UTC, anônima e antes
-- de existir o REGISTRAR_USO=0. Os registros sujavam o uso/analytics do painel ADM.
-- OK do dono em 2026-09-23. Não toca no dataset do TCC.
-- Trava: aborta (e desfaz) se a contagem não for exatamente a conferida antes.
do $$
declare n int;
begin
  delete from public.rotas_calculadas
  where user_id is null
    and criado_em >= '2026-09-23 04:12:00+00' and criado_em < '2026-09-23 05:16:00+00';
  get diagnostics n = row_count;
  if n <> 473 then
    raise exception 'esperava 473 rotas de teste, apagaria %', n;
  end if;
end $$;
