#!/bin/sh
# Publica o bot, mas so' depois de provar que o que esta no disco e' o que
# deveria estar.
#
# Isto existe por uma coisa que aconteceu QUATRO vezes numa sessao: o
# container onde eu trabalho reiniciou e devolveu uma copia antiga do
# projeto, sem avisar. Nas quatro eu percebi -- em duas por sorte, depois de
# ja ter o commit pronto. Na quinta eu publicaria codigo de ontem por cima do
# de hoje, apagando trabalho que ja esta no ar.
#
# A conferencia e' curta de proposito: qualquer coisa mais elaborada seria
# pulada com pressa, e uma trava que se pula nao e' trava.
set -e
cd "$(dirname "$0")"

RAMO=$(git rev-parse --abbrev-ref HEAD)

# Cabeca solta nao tem ramo, entao nao tem com o que comparar -- e a
# comparacao e' a unica coisa que este script faz. Sem ela, ele viraria um
# "fly deploy" com passos a mais, que e' pior do que nao existir: da a
# sensacao de conferido sem conferir nada.
if [ "$RAMO" = "HEAD" ]; then
  echo "RECUSADO: cabeca solta (detached HEAD), sem ramo para comparar."
  echo "  Conserto: git checkout <ramo> antes de publicar."
  exit 1
fi

git fetch -q origin "$RAMO" 2>/dev/null || {
  echo "RECUSADO: nao consegui falar com o GitHub para comparar."
  echo "  Publicar as cegas e' exatamente o que este script existe para impedir."
  exit 1
}
ATRAS=$(git rev-list --count "HEAD..origin/$RAMO" 2>/dev/null || echo 0)
SUJO=$(git status --porcelain -- . | wc -l)

if [ "$ATRAS" -gt 0 ]; then
  echo "RECUSADO: o disco esta $ATRAS commit(s) ATRAS do GitHub."
  echo "  Publicar agora apagaria trabalho que ja esta no ar."
  echo "  Conserto: git reset --hard origin/$RAMO"
  exit 1
fi

if [ "$SUJO" -gt 0 ]; then
  echo "AVISO: ha $SUJO arquivo(s) alterado(s) e nao commitado(s)."
  echo "  Vou publicar o que esta no DISCO, que nao esta no GitHub."
  echo "  Se nao for isso que voce quer, pare agora (Ctrl-C)."
fi

node --check index.js || { echo "RECUSADO: index.js nao compila."; exit 1; }

# Os testes rodam AQUI, sem rede e sem Discord -- nenhuma frase deles chega em
# servidor nenhum. Levam menos de um segundo, e sao a unica coisa neste script
# que olha o que o codigo FAZ, e nao apenas se ele compila.
node testes.js || { echo "RECUSADO: teste(s) falhando -- veja acima."; exit 1; }

echo "ok: ramo $RAMO, em dia com o GitHub, compila e passa nos testes."
echo "publicando $(git rev-parse --short HEAD)..."

exec fly deploy --remote-only --depot=false "$@"
