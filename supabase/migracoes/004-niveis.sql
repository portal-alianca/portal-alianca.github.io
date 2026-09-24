-- Os dois niveis do plano pago: Pro e Alianca.
--
-- O "pago" de antes (20 idiomas, 10 canais, R$ 79) e' a Alianca, e continua
-- igual para quem ja' tem. O Pro e' o degrau de baixo (5 idiomas, 3 canais,
-- R$ 29,90), com teto de traducao que cabe no preco.
--
-- `plano`/`pago_ate`/`teste_ate` continuam dizendo SE o servidor e' pago;
-- `nivel` diz QUAL pago. Assim nada que ja' pergunta "e' pago?" precisa mudar.
--
-- Rodar: painel do Supabase → SQL Editor → colar → Run. E' idempotente.

alter table cyron_servidor
  add column if not exists nivel text not null default 'pro';

do $$ begin
  alter table cyron_servidor add constraint cyron_servidor_nivel_valido check (nivel in ('pro', 'alianca'));
exception when duplicate_object then null; end $$;

-- Quem ja' era liberado na mao ou tinha pagamento em dia ganhou o pago de
-- 20 idiomas: continua com ele.
update cyron_servidor set nivel = 'alianca'
 where nivel = 'pro' and (plano = 'pago' or pago_ate > now());
