# Conta Carta — versão Node.js + SQLite

## Arranque no Windows

1. Instalar **Node.js 22.13 ou superior** a partir de https://nodejs.org/ (a funcionalidade SQLite nativa requer Node.js moderno).
2. Encerrar todas as janelas antigas do Conta Carta e **fazer uma cópia de segurança de `dados/contacarta.sqlite3`**.
3. Extrair o ZIP e fazer duplo clique em `Iniciar_Windows.bat`.
4. Abrir `http://localhost:8000` caso a janela não se abra automaticamente.

Na pasta do projecto, também é possível executar `npm start`. **Não existem dependências externas npm**; `npm install` não é necessário.

## Organização

- `backend/server.js`: servidor HTTP e rotas da API;
- `backend/shared/database.js`: abertura, verificação e ligação SQLite (um ficheiro só);
- `backend/shared/http.js`: leitura dos pedidos, validação e respostas HTTP;
- `backend/modules/state.js`: o estado guardado (registos, lotes e material), com número de revisão;
- `backend/modules/delegations.js`: a tabela das delegações, sempre igual ao catálogo do ecrã;
- `backend/modules/operations.js`: registo de quantidades, limites, saldos e produção por delegação;
- `backend/modules/follow.js`: os movimentos acompanham o estado gravado (a cópia importada, o exemplo, o lote ou o artigo que deixou de existir);
- `app/lib/delegations.js`: o catálogo das delegações, uma por província — o único sítio onde estão escritas;
- `app/lib/core.js`: as regras, e as listas que só existem aqui — motivos do INCAPE, máquinas, contrato do material;
- `app/lib/daybook.js` e `app/lib/lotbook.js`: as gravações de um dia, e as de um lote ou de um artigo do armazém;
- `app/components/lock.js`: a fechadura — o que vem de uma lista abre preenchido e trancado, e «Editar» abre-o;
- `app/lib/`: núcleo e ferramentas herdados do sistema original;
- `app/views/operations.js`: produção por delegação, formulário de movimentos, saldos e histórico;
- `app/components/map.js`: mapa das províncias, cada uma com o tom e o número da sua delegação;
- `app/mocambique.svg`: desenho das províncias, da simplemaps.com, tal como foi publicado;
- `app/sample.json`: os dados fictícios, com registos, lotes, material e movimentos;
- `app/views/`: restantes vistas existentes;
- `tests/`: testes automatizados.

## Um lado só

Cada coisa escreve-se num sítio só. O que já está escrito noutro lado vem de lá, preenchido — e **trancado**: para o mudar liga-se **«Editar»**, e a correcção fica na origem, não numa cópia.

| O quê | Onde se escreve | Quem o lê sozinho |
|---|---|---|
| Referência, delegação e cartas de um lote | no lote (quadro dos Lotes) | o dia de produção em que o lote é apontado, os saldos e a lista por delegação |
| Impressão e teste de qualidade de um lote | nos dias de produção em que é apontado — ou nos movimentos, se o lote nunca passa pelos dias | o quadro dos Lotes, os saldos e a lista por delegação |
| Personalização, passagem ao despacho e despacho | nos movimentos do Painel | o quadro dos Lotes |
| Entradas e saídas do armazém | nos movimentos do Painel, escolhendo o artigo da lista | o artigo do Armazém (recebido, saído, datas) |
| Nome, tipo, unidade e contratado de um material | no contrato (a lista que vem com o programa) | o artigo do Armazém |

Na prática:

- **Dia de produção.** Escolhe-se um lote preparado e a referência, a delegação e as cartas chegam do quadro, trancadas. O dia planeia sozinho o que o lote ainda tinha por fazer («54 de 54 cartas por fazer (o lote já tinha 346 boas)»). Com «Editar» ligado corrige-se o próprio lote — no quadro e em todos os dias em que já foi apontado. Escrever à mão a referência de um lote do quadro puxa esse lote, em vez de nascer uma cópia dele. Um lote aponta-se uma vez por dia; mudar a data de uma linha passa-a para o outro dia.
- **Quadro dos Lotes.** Os dados de um lote que já existe abrem trancados. Cada fase diz de onde vem: «segue os movimentos do Painel» ou «segue os dias de produção» — essas só se lêem. Só a fase que ninguém regista se marca à mão. Um lote que já anda pelos movimentos segue-os em tudo.
- **Movimentos.** A impressão e o teste de um lote apontado nos dias **não se registam outra vez**: nesses movimentos o lote aparece desligado, com o porquê («regista-se nos dias de produção»), e as cartas que os dias deram por aprovadas ficam logo prontas para mover e despachar. Ao contrário, um lote que regista a impressão nos movimentos não se aponta nos dias. A mesma carta não se conta duas vezes.
- **Armazém.** O material escolhe-se do contrato e chega preenchido e trancado. Uma entrada ou uma saída registada nos movimentos soma sozinha no artigo; não se actualiza o artigo à mão por causa dela.
- **Corrigir depois.** Os dias de um lote não podem ficar com menos cartas aprovadas do que as que já foram movidas para despacho, nem o lote com menos cartas do que as já personalizadas: o programa recusa e diz porquê.

No servidor, a regra corre em todas as gravações (`core.settle`, a mesma que o ecrã usa): o que fica guardado está sempre de acordo, mesmo quando vem de uma base de uma versão anterior — essa fica acertada uma vez, ao abrir.

## Regras operacionais

O formulário **Fluxo operacional por quantidades** fica no Painel, por baixo do primeiro ecrã: desce-se com o scroll, a seguir à **Produção por delegação**. O primeiro ecrã do Painel, o que se vê na TV, tem só o período, os indicadores e os separadores Máquinas, Gráfico e Registos. O formulário controla personalização, impressão, aprovação no QC, movimentação para despacho e despacho parcial. A introdução segue a ordem cronológica e as quantidades não podem exceder os saldos disponíveis.

- Impressões e reimpressões são tentativas; rejeições regressam à fila de impressão.
- Uma carta aprovada apenas poderá seguir para despacho depois de movimentada para a respectiva área.
- Um erro de lote por resolver impede o despacho.
- As rejeições QC exigem um motivo do INCAPE; a lista «Outro» é uma categoria local provisória.
- As entradas e saídas do armazém escolhem o material na lista do armazém; a saída confere o saldo desse artigo.
- Os campos de série permitem registar intervalos numéricos; cada intervalo deve coincidir com a quantidade e não pode repetir outro intervalo de igual tipo no mesmo artigo.
- Os movimentos são imutáveis na interface, para preservar o histórico. Correcções requerem um procedimento administrativo ainda por definir.
- Apagar um lote, ou um artigo do armazém, apaga também os seus movimentos; o programa avisa antes de o fazer. Os dias em que o lote foi apontado continuam a contar a produção, já sem lote no quadro.
- A quantidade de um lote não pode baixar para menos do que já tem personalizado.
- A caixa da quantidade diz quanto há («até 250»): o saldo do lote nessa fase, ou o do artigo que sai do armazém.

## Delegações e mapa

Há **uma delegação por província** e a da **Cidade de Maputo**: onze ao todo. Na província de Maputo a delegação é a da **Matola**. O catálogo está escrito num sítio só, `app/lib/delegations.js`, e é o mesmo para as listas de escolha (no lote e no dia de produção), para o mapa e para o servidor.

| Delegação | Província |
|---|---|
| Maputo Cidade | Maputo Cidade |
| Matola | Maputo |
| Xai-Xai | Gaza |
| Inhambane | Inhambane |
| Beira | Sofala |
| Chimoio | Manica |
| Tete | Tete |
| Quelimane | Zambézia |
| Nampula | Nampula |
| Lichinga | Niassa |
| Pemba | Cabo Delgado |

A Matola e Maputo Cidade são as que foram indicadas para esta versão. As outras nove levam o nome da capital da província e ficam **sujeitas a confirmação**: trocar um nome é mudar uma linha desse ficheiro.

O mapa não tem pontos. Cada província mostra o tom e o número de cartas produzidas da sua delegação — **os mesmos números e os mesmos tons da lista ao lado**, que tem sempre as onze linhas e o total. Clicar numa província ou numa linha destaca as duas; «Limpar escolha» tira o destaque. A Cidade de Maputo é pequena de mais para levar o número por cima: tem-no ao lado, ligado por um traço.

Um nome escrito de outra maneira num registo antigo («Delegação da Beira», «Nacala», «Maputo Província») soma na delegação a que pertence, e continua a aparecer no formulário desse registo, marcado como «registo anterior». Um nome que não se reconhece fica com linha própria na lista, «fora do catálogo», e não entra no mapa: corrige-se escolhendo a delegação no lote ou no registo.

O desenho das províncias é o da simplemaps.com (`app/mocambique.svg`, com a nota de direitos de origem, que permite o uso): serve para visualização, não é cartografia oficial nem cadastral. O mapa funciona sem ligação à Internet.

## Base de dados

- **Um ficheiro só**: `dados/contacarta.sqlite3` (ou o caminho indicado em `CONTACARTA_DB`). Cada gravação fica completa nesse ficheiro antes de o programa responder; copiá-lo, de preferência com o programa fechado, copia tudo.
- Uma base deixada por uma versão anterior abre-se sem perder nada: o que estava nos ficheiros ao lado (`-wal` e `-shm`) passa para o ficheiro principal no arranque, e um documento de uma versão antiga é convertido.
- Gravar os registos e acertar os movimentos é uma operação só: ou fica tudo, ou não fica nada.
- Uma base que não se consegue ler trava o arranque com uma frase a dizer porquê, e o ficheiro fica exactamente como estava.
- Abrir o programa duas vezes: a segunda janela diz que a porta está ocupada e fecha-se; os registos ficam como estavam.
- Se outro programa tiver o ficheiro preso a meio de uma escrita, o Conta Carta espera cinco segundos e depois recusa a gravação com uma frase («A base de dados está ocupada por outro programa…»); nada se perde, e libertado o ficheiro grava como sempre.
- Um pedido mal feito é recusado com uma frase (400, 403, 404, 405, 409 ou 422) e não altera nada.

A aplicação **não apaga o documento SQLite antigo**, preservando os lotes, materiais e registos já guardados. Os movimentos operacionais são armazenados na tabela `operations` da mesma base. Os registos de produção com delegação identificada contam como produzidas na sua delegação; as cartas boas de um lote do quadro, apontado nos dias e concluído, contam também como aprovadas. Um lote escrito só no dia, sem estar no quadro, não se move nem se despacha.

O quadro dos Lotes e os **Saldos por lote** dizem o mesmo: as fases do quadro saem dos movimentos e dos dias de produção, pela mesma conta. Um movimento antigo do armazém, de quando o material se escrevia à mão, fica no histórico mas não soma em artigo nenhum.

## Cópias de segurança

**Exportar cópia** leva tudo num ficheiro `.json`: registos, lotes, material e movimentos. **Importar cópia** substitui os registos pelos do ficheiro. Se o ficheiro traz movimentos, substituem os que lá estão; se é uma cópia antiga, sem movimentos, ficam os dos lotes e do material que continuarem a existir. A pergunta de confirmação diz sempre qual dos casos é.

## Dados fictícios

**Ver com dados fictícios** junta um exemplo aos dados que houver; **Remover dados fictícios** tira-o inteiro, e os teus ficam. O exemplo traz 52 registos de produção, os 25 artigos do contrato, 16 lotes (`EX-101` a `EX-116`) espalhados pelas onze delegações e 74 movimentos. Na lista por delegação somam 33 116 cartas produzidas, 15 950 aprovadas e 9000 despachadas. Cada lote ficou num ponto diferente do fluxo, para se poder experimentar cada regra:

| Lote | Delegação | Onde ficou | Para experimentar |
|---|---|---|---|
| EX-101, EX-102 | Maputo Cidade, Matola | despachados por inteiro | imprimir, aprovar ou despachar mais é recusado |
| EX-103 | Nampula | 1500 despachadas; 700 na área de despacho, 400 por controlar | despachar, ou aprovar o resto |
| EX-104 | Beira | 1600 na área de despacho, 400 por mover | despachar com guia; mover as 400 |
| EX-105 | Quelimane | controlo a decorrer; 30 reprovadas voltam à impressão | reimprimir 30 |
| EX-106 | Tete | impressão a decorrer, 520 por imprimir | imprimir; rejeitar na impressão |
| EX-107 | Xai-Xai | 12 erros de lote por resolver | o despacho é recusado até se registar «erro resolvido» |
| EX-108 | Chimoio | erro já resolvido; 500 despachadas | despachar as 300 que faltam |
| EX-109 | Inhambane | personalizado, por imprimir | imprimir mais de 700 é recusado; ou apontá-lo num dia de produção |
| EX-110 | Pemba | personalização a meio | personalizar as outras 300 |
| EX-111 | Lichinga | lote novo, sem movimentos nem dias | as quatro fases marcam-se à mão no lote; imprimir antes de personalizar é recusado |
| EX-112 | Maputo Cidade | cartas por controlar, por mover e por despachar ao mesmo tempo | aprovar, mover e despachar: há saldo nos três |
| EX-113 | Nampula | 1500 despachadas; 50 reprovadas voltam à impressão | reimprimir 50 |
| EX-114 | Matola | metade despachada | despachar as outras 700 |
| EX-115 | Beira | 400 impressas, à espera do controlo | aprovar ou reprovar no QC; no dia de produção não é oferecido |
| EX-116 | Inhambane | apontado em dois dias de produção, sem movimentos: 346 boas, 250 aprovadas | escolhê-lo num dia novo (chega trancado, com 54 por fazer); mover e despachar as 250; imprimir pelos movimentos está desligado |

No armazém, os 25 artigos são os do contrato. Os movimentos registam a entrada de 30 000 cartões em branco (séries `0100001` a `0130000`) e a saída de 20 000, que já estão somadas no artigo: pedir mais de 10 000 dá «Stock insuficiente», e repetir um intervalo de séries já usado é recusado. No quadro dos Lotes, cada fase diz o mesmo que os movimentos ou os dias de onde vem: das 64 fases, 56 seguem os movimentos, 2 os dias de produção e 6 marcam-se à mão.

## Testes

```powershell
npm test
node tests/test-core.cjs
node tests/test-ui.cjs
node tests/test-static.cjs
python3 -m unittest discover -s tests -p "test_*.py"
```

`npm test` cobre o servidor e a base de dados: limites de saldo, despacho parcial, reimpressões, entradas/saídas do armazém a somar no artigo e intervalos sobrepostos; «um lado só» (os dias a seguir o lote, as fases a seguir os dias e os movimentos, e a impressão que não se regista duas vezes); as onze delegações e a soma dos nomes antigos; o exemplo a entrar e a sair inteiro; as cópias com movimentos; o ficheiro único, as bases de versões anteriores, a base ilegível, a base presa por outro programa e a segunda janela. Os estáticos conferem o mapa: as onze províncias do ficheiro original, as mesmas onze do catálogo, e nenhum ponto. O detalhe está em `VERIFICACAO.md`.

## Versão `.exe`

O servidor Python (`server.py`, o que vai dentro do `.exe`) guarda os registos, os lotes e o material, mas **não guarda movimentos**. Com ele, a Produção por delegação e o Fluxo operacional não aparecem; o resto funciona, incluindo as onze delegações nos formulários, o lote preparado que chega trancado ao dia de produção e o quadro dos Lotes a seguir os dias. Importar nele uma cópia que traga movimentos deixa-os de fora, e a pergunta de confirmação avisa.

## Segurança

Este servidor está limitado a `127.0.0.1`, para utilização local. A versão não fornece autenticação nem acesso multiutilizador remoto. Não a publique na rede ou na Internet sem autenticação, permissões, HTTPS e testes de concorrência adicionais.

## Endpoints

- `GET /api/state`, `PUT /api/state`: compatibilidade com a aplicação anterior e revisão optimista; o `PUT` aceita `operations`, a lista de movimentos de uma cópia importada, gravada na mesma transacção. Responde `{revision}`, ou `{revision, state}` quando o que ficou guardado não é exactamente o que veio (uma fase que os movimentos ou os dias dizem de outra maneira);
- `GET /api/delegations`: as onze delegações (`code`, `name`, `province`);
- `GET /api/operations`: saldos, movimentos e produção por delegação (filtros `start`, `end`); `delegations` tem sempre as onze linhas e `summary` é a soma delas; cada lote de `batches` traz `driven` (as fases que os movimentos dizem), `byDays` (a impressão e o teste lêem-se dos dias) e `byMoves` (registam-se nos movimentos);
- `POST /api/operations`: novo movimento validado. Os do armazém levam `stockId`, o artigo da lista. A resposta traz o que o movimento mudou — `lot` ou `stock` — com a revisão nova, gravado na mesma transacção.
