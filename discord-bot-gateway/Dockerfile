FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

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
