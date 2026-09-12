FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
# O lockfile ENTRA na imagem, e a instalação é `ci`.
#
# Com `npm install` e só o package.json, esta linha resolvia a árvore de
# dependências por conta própria, no dia do build -- separada da que o CI
# tinha acabado de testar. "Testado e aprovado" valia para uma árvore e o
# Discord recebia outra.
#
# `ci` instala EXATAMENTE o que está no lockfile, e recusa se ele discordar do
# package.json. É a linha que faz os testes da esteira valerem para o processo
# que realmente sobe.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# A pasta inteira, e nao uma lista de arquivos.
#
# Aqui estava `COPY index.js ./`, e isso derrubou o bot por uma noite inteira.
# Eu parti o codigo em dois arquivos -- index.js passou a importar catalogo.js
# -- e a lista aqui continuou com um nome so'. A imagem subiu sem o segundo
# arquivo, o Node morreu na primeira linha com
#
#   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/catalogo.js'
#
# e o Fly reiniciou dez vezes ate' desistir e deixar a maquina parada.
#
# O pior nao foi o erro: foi ele ser INVISIVEL. O deploy passou verde (ele
# constroi e envia a imagem, nao roda o processo), os testes passaram (aqui o
# arquivo existe), e no Discord o sintoma foi "o aplicativo nao respondeu" --
# que parece lentidao, e me fez consertar tres coisas erradas antes de olhar
# para esta.
#
# Lista de arquivos e' uma promessa que envelhece a cada arquivo novo. A pasta
# inteira nao tem como ficar desatualizada; o que nao deve entrar mora no
# .dockerignore, que e' onde se olha quando a duvida e' "por que isto foi
# parar na imagem".
COPY . ./
CMD ["node", "index.js"]
