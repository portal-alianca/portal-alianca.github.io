# Aprendiz

Você joga. Ela olha. Depois ela joga sozinha, com o que aprendeu de você.

## O que faz este app não ser um truque

**Ela aprende de verdade.** É uma rede pequena (11 entradas → 16 → 3 ações)
escrita à mão em `cerebro.js`, sem biblioteca nenhuma. Treina em cerca de um
segundo, no seu celular, sem mandar nada para lugar nenhum.

**O número é honesto.** Um quarto das suas jogadas fica ESCONDIDO do treino, e
o acerto é medido só nelas — em situações que ela nunca viu. Por isso o número
pode CAIR, e quando cai a tela diz "caiu 26". Barra de progresso que só sobe é
enfeite; a que pode cair é a única que significa alguma coisa.

**Ensine mal e ela joga mal.** Isso é o recurso, não o defeito.

## Medido, e não estimado

Com um professor que joga por uma regra fixa:

| partidas ensinando | acerto | come por partida |
|---|---|---|
| 3  | 94% | 23,6 |
| 5  | 98% | 26,9 |
| 25 | 98% | 27,1 |

Três partidas já bastam. E dentro do app, com um cérebro assim, ela fez 22.

## Os arquivos

    index.html    a tela inteira
    jogo.js       a cobrinha, sem tela -- roda em teste
    cerebro.js    a rede, escrita à mão
    testes.mjs    33 testes, sem navegador: node testes.mjs
    sw.js         para abrir sem internet
    manifest.json + icone.svg   para instalar como app

56 KB no total. Não fala com servidor nenhum: tudo o que ela aprendeu fica no
seu aparelho.

## Rodar aqui

    python3 -m http.server 8000
    # abre http://localhost:8000

Precisa de servidor (nem que seja esse) porque são módulos ES — abrir o
arquivo direto pelo `file://` não carrega.

## Publicar

Qualquer hospedagem de arquivo estático serve. No GitHub Pages: sobe os
arquivos num repositório, liga Pages em Settings, e o endereço que sair já
instala no celular — no Android o navegador oferece "Instalar app"; no iPhone
é Compartilhar → Adicionar à Tela de Início.
