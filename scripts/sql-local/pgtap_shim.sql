-- Subconjunto mínimo de pgTAP (plan, ok, is, lives_ok, throws_ok, finish) para correr
-- supabase/tests/*.test.sql con psql cuando pgTAP no está instalado.
-- Cada aserción imprime "ok N - ..." o lanza una excepción (falla inmediata, psql sale con error).
create function plan(n integer) returns text language plpgsql as $$
begin
  perform set_config('shim.n', '0', false);
  return '1..' || n;
end $$;

create function _shim_next() returns integer language plpgsql as $$
declare v integer := coalesce(nullif(current_setting('shim.n', true), ''), '0')::integer + 1;
begin
  perform set_config('shim.n', v::text, false);
  return v;
end $$;

create function ok(cond boolean, descr text) returns text language plpgsql as $$
declare n integer := _shim_next();
begin
  if cond is not true then raise exception 'not ok % - %', n, descr; end if;
  return format('ok %s - %s', n, descr);
end $$;

create function is(got anyelement, want anyelement, descr text) returns text language plpgsql as $$
declare n integer := _shim_next();
begin
  if got is distinct from want then
    raise exception 'not ok % - % (obtenido: %, esperado: %)', n, descr, got, want;
  end if;
  return format('ok %s - %s', n, descr);
end $$;

create function lives_ok(code text, descr text) returns text language plpgsql as $$
declare n integer := _shim_next();
begin
  begin
    execute code;
  exception when others then
    raise exception 'not ok % - % (error: % %)', n, descr, sqlstate, sqlerrm;
  end;
  return format('ok %s - %s', n, descr);
end $$;

create function throws_ok(code text, errcode char(5), errmsg text, descr text) returns text language plpgsql as $$
declare n integer := _shim_next();
begin
  begin
    execute code;
  exception when others then
    if (errcode is null or sqlstate = errcode) and (errmsg is null or sqlerrm = errmsg) then
      return format('ok %s - %s', n, descr);
    end if;
    raise exception 'not ok % - % (error obtenido: % "%")', n, descr, sqlstate, sqlerrm;
  end;
  raise exception 'not ok % - % (no lanzó error)', n, descr;
end $$;

create function finish() returns setof text language plpgsql as $$
begin
  return next '# ' || coalesce(current_setting('shim.n', true), '0') || ' aserciones ok';
end $$;
