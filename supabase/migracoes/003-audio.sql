-- Quanto audio cada servidor transcreveu no mes (o 🎧).
--
-- A cota gratis da Azure Speech e' de 5 horas por mes para TODOS os
-- servidores juntos. Sem conta por servidor, um servidor grande e animado
-- esgotaria a de todo mundo -- e ninguem saberia quem foi. Aqui cada um tem
-- o seu teto (padrao 60 minutos, ajustavel no /admin → 🎧 Audio).
--
-- Nada de pessoa, nada de audio, nada de texto: so' o servidor, o mes e os
-- segundos. A pagina de privacidade nao muda.
--
-- Rodar: painel do Supabase → SQL Editor → colar → Run. E' idempotente.

create table if not exists cyron_uso_audio (
  servidor_id  uuid    not null references cyron_servidor(id) on delete cascade,
  mes          date    not null,             -- o dia 1 do mes
  segundos     integer not null default 0,
  transcricoes integer not null default 0,
  primary key (servidor_id, mes)
);

-- Sem policy de proposito: so' o bot (service role) le e escreve.
alter table cyron_uso_audio enable row level security;

-- Somar numa instrucao so'. Dois cliques no mesmo instante fariam um
-- ler-somar-gravar perder segundos; o upsert com soma nao perde nenhum.
-- Devolve o total do mes ja' com a soma.
create or replace function cyron_somar_audio(p_servidor uuid, p_mes date, p_segundos integer)
returns integer
language sql
as $$
  insert into cyron_uso_audio (servidor_id, mes, segundos, transcricoes)
  values (p_servidor, p_mes, greatest(p_segundos, 0), 1)
  on conflict (servidor_id, mes) do update
    set segundos     = cyron_uso_audio.segundos + excluded.segundos,
        transcricoes = cyron_uso_audio.transcricoes + 1
  returning segundos;
$$;

-- So' o bot soma. Sem isto, qualquer um com a chave publica poderia chamar a
-- funcao pela API (a RLS ja' barraria a escrita, mas nao se depende de uma
-- trava so').
revoke execute on function cyron_somar_audio(uuid, date, integer) from public, anon, authenticated;
grant execute on function cyron_somar_audio(uuid, date, integer) to service_role;
