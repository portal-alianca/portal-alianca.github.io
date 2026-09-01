-- A Arena das Línguas
--
-- Uma linha por jogador, por servidor. Nada de nome, nada de mensagem: só o
-- identificador do Discord, o idioma pelo qual a pessoa luta, e os números do
-- jogo. É dado pessoal novo, então a página de privacidade mudou junto com
-- este arquivo -- prometer o que se guarda e depois guardar mais é o defeito
-- que a página existe para não cometer.
--
-- Rodar: painel do Supabase → SQL Editor → colar → Run. É idempotente.

create table if not exists cyron_arena (
  servidor_id     uuid not null references cyron_servidor(id) on delete cascade,
  discord_user_id text not null,
  idioma          text not null,
  poder           integer not null default 1,
  ouro            integer not null default 0,
  vitorias        integer not null default 0,
  ataques_dia     integer not null default 0,
  dia             date not null default current_date,
  temporada       date,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  primary key (servidor_id, discord_user_id)
);

-- O placar lê todos os jogadores de um servidor a cada desenho.
create index if not exists cyron_arena_servidor on cyron_arena (servidor_id);

-- Um ataque inteiro numa instrução só.
--
-- Dois cliques no mesmo instante leriam o mesmo ouro e escreveriam por cima um
-- do outro. Aqui a linha é travada com `for update`, então nem a conta de
-- ataques do dia nem o ouro podem ser furados clicando rápido.
--
-- Devolve o estado depois do ataque, para o bot não precisar reler.
create or replace function cyron_arena_atacar(
  p_servidor  uuid,
  p_user      text,
  p_idioma    text,
  p_max_dia   integer,
  p_venceu    boolean,
  p_hoje      date,
  p_temporada date
) returns table (ok boolean, motivo text, poder int, ouro int, vitorias int, ataques_dia int)
language plpgsql
as $$
declare
  l cyron_arena;
begin
  insert into cyron_arena (servidor_id, discord_user_id, idioma, dia, temporada)
  values (p_servidor, p_user, p_idioma, p_hoje, p_temporada)
  on conflict (servidor_id, discord_user_id) do nothing;

  select * into l from cyron_arena
   where servidor_id = p_servidor and discord_user_id = p_user
   for update;

  -- Vira o dia: zera a conta de ataques ANTES de conferir o teto, senão quem
  -- gastou tudo ontem começa hoje sem ataque nenhum.
  if l.dia is distinct from p_hoje then
    l.ataques_dia := 0;
  end if;

  -- Vira a temporada: as vitórias são da semana, o poder e o ouro são de
  -- sempre. Zerar o progresso toda segunda faria evoluir não valer nada.
  if l.temporada is distinct from p_temporada then
    l.vitorias := 0;
  end if;

  if l.ataques_dia >= p_max_dia then
    update cyron_arena
       set dia = p_hoje, ataques_dia = l.ataques_dia,
           temporada = p_temporada, vitorias = l.vitorias
     where servidor_id = p_servidor and discord_user_id = p_user;
    return query select false, 'sem ataques hoje'::text, l.poder, l.ouro, l.vitorias, l.ataques_dia;
    return;
  end if;

  update cyron_arena
     set ataques_dia   = l.ataques_dia + 1,
         dia           = p_hoje,
         temporada     = p_temporada,
         vitorias      = l.vitorias + case when p_venceu then 1 else 0 end,
         ouro          = ouro + case when p_venceu then 5 else 1 end,
         idioma        = p_idioma,
         atualizado_em = now()
   where servidor_id = p_servidor and discord_user_id = p_user
   returning * into l;

  return query select true, null::text, l.poder, l.ouro, l.vitorias, l.ataques_dia;
end;
$$;

-- Evoluir: só gasta se tiver, e a checagem e a subtração são a mesma
-- instrução -- senão dois cliques comprariam dois níveis com um ouro só.
create or replace function cyron_arena_evoluir(
  p_servidor uuid,
  p_user     text,
  p_custo    integer
) returns table (ok boolean, poder int, ouro int)
language plpgsql
as $$
declare
  l cyron_arena;
begin
  update cyron_arena
     set poder = poder + 1, ouro = ouro - p_custo, atualizado_em = now()
   where servidor_id = p_servidor and discord_user_id = p_user and ouro >= p_custo
   returning * into l;

  if found then
    return query select true, l.poder, l.ouro;
    return;
  end if;

  select * into l from cyron_arena
   where servidor_id = p_servidor and discord_user_id = p_user;
  return query select false, coalesce(l.poder, 1), coalesce(l.ouro, 0);
end;
$$;
