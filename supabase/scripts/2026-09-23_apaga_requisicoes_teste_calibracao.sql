-- Expurgo das requisições HTTP de teste da mesma calibração de semáforo
-- (2026-09-23 entre 04:12 e 05:15 UTC, anônimas, antes do REGISTRAR_USO=0).
-- Complementa 2026-09-23_apaga_rotas_teste_calibracao.sql. OK do dono em 2026-09-23.
-- Trava: aborta (e desfaz) se a contagem não for exatamente a conferida antes.
do $$
declare n int;
begin
  delete from public.api_requisicoes
  where user_id is null
    and criado_em >= '2026-09-23 04:12:00+00' and criado_em < '2026-09-23 05:16:00+00';
  get diagnostics n = row_count;
  if n <> 486 then
    raise exception 'esperava 486 requisições de teste, apagaria %', n;
  end if;
end $$;
