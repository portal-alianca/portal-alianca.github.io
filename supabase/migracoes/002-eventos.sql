-- Eventos com hora, por servidor.
--
-- O fuso NAO aparece aqui, e nao e' esquecimento: o horario vai para o
-- Discord como <t:unix:F>, que ele desenha no relogio de quem esta olhando.
-- Guardar o fuso de cada pessoa seria dado pessoal novo para resolver um
-- problema que ja esta resolvido do outro lado.

create table if not exists cyron_evento (
  id          bigserial primary key,
  servidor_id text        not null,
  guild_id    text        not null,
  titulo      text        not null,
  detalhes    text,
  quando      timestamptz not null,
  votacao     boolean     not null default false,
  criado_por  text        not null,
  msg_id      text,
  criado_em   timestamptz not null default now()
);

create index if not exists cyron_evento_agenda
  on cyron_evento (servidor_id, quando);

-- Uma linha por pessoa por evento. A chave primaria composta e' o que torna
-- o voto seguro sem trava: dois cliques no mesmo instante viram um upsert
-- cada, e o ultimo vale -- em vez de um ler-somar-gravar que perde voto.
create table if not exists cyron_evento_presenca (
  evento_id       bigint      not null references cyron_evento(id) on delete cascade,
  discord_user_id text        not null,
  vai             boolean     not null,
  criado_em       timestamptz not null default now(),
  primary key (evento_id, discord_user_id)
);
