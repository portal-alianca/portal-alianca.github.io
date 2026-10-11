-- 🃏 Heróis no chat: a coleção de cartas de cada pessoa e o /diario.
-- (O número 021 está reservado para a limpeza do histórico do cron.)
--
-- Uma carta é um herói do Duelo numa raridade (1 comum, 2 raro, 3 lendário).
-- Ganha-se pegando o herói que aparece no chat, no /diario, ou de presente.
-- A linha fica mesmo com quantidade 0: é o "já teve", que o álbum mostra.
-- Sem policy de proposito: so' o bot (service role) le e escreve.

create table if not exists cyron_colecao (
  user_id       text        not null check (user_id ~ '^[0-9]{5,25}$'),
  personagem    text        not null check (personagem ~ '^[a-z]{2,20}$'),
  raridade      smallint    not null check (raridade between 1 and 3),
  quantidade    integer     not null default 0 check (quantidade >= 0),
  primeira_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, personagem, raridade)
);
alter table cyron_colecao enable row level security;

create table if not exists cyron_diario (
  user_id     text    primary key check (user_id ~ '^[0-9]{5,25}$'),
  ultimo_dia  date    not null,
  sequencia   integer not null default 1 check (sequencia >= 1),
  melhor      integer not null default 1 check (melhor >= 1),
  total       integer not null default 1 check (total >= 1)
);
alter table cyron_diario enable row level security;

-- +1 carta. Devolve quantas a pessoa tem agora.
create or replace function cyron_ganhar_carta(p_user text, p_personagem text, p_raridade integer)
returns integer language sql security definer set search_path = public as $$
  insert into cyron_colecao as c (user_id, personagem, raridade, quantidade)
  values (p_user, p_personagem, p_raridade, 1)
  on conflict (user_id, personagem, raridade)
  do update set quantidade = c.quantidade + 1, atualizado_em = now()
  returning c.quantidade;
$$;

-- Passa UMA carta de uma pessoa para outra, tudo ou nada. false = quem dá
-- não tem essa carta.
create or replace function cyron_presentear(p_de text, p_para text, p_personagem text, p_raridade integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_de = p_para then return false; end if;
  update cyron_colecao set quantidade = quantidade - 1, atualizado_em = now()
   where user_id = p_de and personagem = p_personagem and raridade = p_raridade and quantidade > 0;
  if not found then return false; end if;
  insert into cyron_colecao as c (user_id, personagem, raridade, quantidade)
  values (p_para, p_personagem, p_raridade, 1)
  on conflict (user_id, personagem, raridade)
  do update set quantidade = c.quantidade + 1, atualizado_em = now();
  return true;
end $$;

-- XP para um herói sem mexer em atualizado_em: é por essa data que o bot
-- sabe qual é o herói ativo da pessoa, e pegar uma carta não troca o herói
-- dela. Herói nunca usado nasce com data antiga pelo mesmo motivo.
create or replace function cyron_somar_xp_heroi(p_user text, p_personagem text, p_xp integer)
returns integer language sql security definer set search_path = public as $$
  insert into cyron_duelo_personagem as d (user_id, personagem, xp, atualizado_em)
  values (p_user, p_personagem, greatest(p_xp, 0), to_timestamp(0))
  on conflict (user_id, personagem)
  do update set xp = d.xp + greatest(p_xp, 0)
  returning d.xp;
$$;

-- O /diario: uma vez por dia (o dia vem do bot, em UTC). Ontem pegou, a
-- sequência sobe; pulou um dia, volta a 1. Dois toques juntos: o segundo
-- recebe ja_pegou = true.
create or replace function cyron_pegar_diario(p_user text, p_dia date)
returns table (ja_pegou boolean, seq integer, recorde integer)
language plpgsql security definer set search_path = public as $$
declare
  atual cyron_diario%rowtype;
  nova integer;
begin
  select * into atual from cyron_diario d where d.user_id = p_user for update;
  if not found then
    insert into cyron_diario (user_id, ultimo_dia) values (p_user, p_dia)
    on conflict (user_id) do nothing;
    if found then
      return query select false, 1, 1;
    else
      return query select true, d.sequencia, d.melhor from cyron_diario d where d.user_id = p_user;
    end if;
    return;
  end if;
  if atual.ultimo_dia >= p_dia then
    return query select true, atual.sequencia, atual.melhor;
    return;
  end if;
  nova := case when atual.ultimo_dia = p_dia - 1 then atual.sequencia + 1 else 1 end;
  update cyron_diario d
     set ultimo_dia = p_dia, sequencia = nova, melhor = greatest(atual.melhor, nova), total = atual.total + 1
   where d.user_id = p_user;
  return query select false, nova, greatest(atual.melhor, nova);
end $$;

revoke all on function cyron_ganhar_carta(text, text, integer) from public, anon, authenticated;
revoke all on function cyron_presentear(text, text, text, integer) from public, anon, authenticated;
revoke all on function cyron_somar_xp_heroi(text, text, integer) from public, anon, authenticated;
revoke all on function cyron_pegar_diario(text, date) from public, anon, authenticated;
grant execute on function cyron_ganhar_carta(text, text, integer) to service_role;
grant execute on function cyron_presentear(text, text, text, integer) to service_role;
grant execute on function cyron_somar_xp_heroi(text, text, integer) to service_role;
grant execute on function cyron_pegar_diario(text, date) to service_role;
