# Verificação do projecto

Cinco suites automáticas, todas sem rede e sem browser: o núcleo, a interface (num DOM mínimo), as
verificações estáticas ao que é servido, o servidor Node com a sua base de dados e o servidor Python. Usam
exclusivamente números fictícios e bases temporárias — nenhum toque em `dados/`.

```text
node tests/test-core.cjs      # 28 secções: datas, cálculos, lotes do dia, motivos, armazém, delegações, migração, CSV, um lado só
node tests/test-ui.cjs        # 41 secções: dia de produção, painel, armazém, lotes, formulário, fechadura, relatórios, comparação, PDF, CSV, cópias, exemplo, ajuda, 144 ids
node tests/test-static.cjs    # 13 secções: ficheiros, marca e logótipo, ajuda, erros, datas, impressão, rede, docs, mapa
npm test                      # 20 testes (tests/test-operations.cjs): movimentos, saldos, um lado só, delegações, exemplo, cópias e o ficheiro SQLite
python3 -m unittest discover -s tests -p "test_*.py"   # 15 testes: estado, revisões, cópias, lotes, material, limites, logs
```

## O que cada suite segura

**Núcleo (`test-core.cjs`).** Datas inválidas e anos bissextos; intervalos de mês e de semana; percentagens
com zero denominador; **o dia como uma lista de lotes**: as cartas do dia são a soma dos lotes, cada lote
guarda a máquina, as planeadas, as produzidas e as duas rejeições, e `makeEntry` só fecha um lote com cartas
(`done` exige produção); um lote «em curso» não conta como concluído (`entryState`, `dayStatus`); `done` de
um lote sem cartas fica falso; `aprovadas = produzidas − chumbadas no teste` (com as rejeitadas que voltam ao lote
contadas como retrabalho); motivos do INCAPE por lote, só os seis e só com chumbadas; lotes com as quatro fases e
referências distintas; armazém com saldo, mínimo de alerta e por entregar; um registo só conta se couber inteiro no
período; sobreposições recusadas; limites de quantidade e de notas; migração de cópias v1 a v5 (as máquinas
antigas entram como lotes concluídos, os totais declarados viram um lote); CSV com BOM,
`;` e células à prova de fórmulas. Na comparação: exactamente dois períodos lado a lado, pela ordem
escolhida, com os nomes dos meses por extenso; a diferença do 2.º para o 1.º (cartas e pontos de taxa);
a leitura automática; o CSV próprio da comparação, com número e nome de cada período. No sumário e na
rejeição, o CSV leva as linhas `Etiqueta` (número) e `Nome` (por extenso). **As delegações**: onze, uma por
província e a da Cidade de Maputo, com a Matola na província de Maputo; os nomes por que já foram escritas
(«Delegação da Beira», «Maputo Província», o nome da província, os lugares do catálogo anterior) encontram a
sua, e o que não se reconhece não se inventa; a lista de um formulário tem as onze e, num registo antigo, o
nome que já lá estava; o exemplo tem lotes das onze e cada movimento dele é do armazém ou de um lote seu.
**Um lado só** (`core.settle`, a regra que corre em todas as gravações): a entrada de um dia ligada a um lote diz
a referência e a delegação do lote e planeia o que ele ainda tinha por fazer; a impressão do lote são as cartas
boas dos dias e a qualidade as das entradas concluídas; a entrada que apontava um lote que já não existe fica
sem ligação; o que já está de acordo volta tal e qual. O que os dias dizem de cada lote (`core.lotDays`) é o que
o quadro e os movimentos lêem. O livro dos lotes sabe de onde vem cada fase e recusa apontar num dia um lote
com a impressão nos movimentos. O contrato não oferece duas vezes o mesmo material, mesmo escrito de outra
maneira. A fechadura: o que vem de uma lista abre trancado, só o interruptor o abre, e trancar outra vez
desliga-o.

**Interface (`test-ui.cjs`).** Os 144 `id` usados pelo código existem no HTML; **o dia de produção**: apontar o
primeiro lote, o segundo na outra máquina, um lote que fica em curso («Lote concluído» desmarcado) e se conclui
na linha do dia, o cabeçalho com os números somados dos lotes, a lista dos dias com o ano, «Terminar dia» e
«Reabrir o dia»; concluir um lote chega para o painel do mês contar o dia, sem mais nenhum passo; guardar, editar e eliminar;
 os três modos do filtro — mês, ano (média mensal no KPI e doze
barras no gráfico) e intervalo — e a linha «face ao período anterior», que só aparece quando o período
anterior tem números; a comparação de meses e de anos no papel, com a tabela lado a lado, a diferença e a leitura escrita;
as vistas do Armazém e dos Lotes (KPIs, tabelas, filtros, diálogos e gravação sem perder os outros dados);
os relatórios de motivos, lotes e armazém, com tabela, CSV e PDF próprios; a barra de alertas do Painel;
a pré-visualização do relatório igual ao PDF (mesma marca, mesmos KPIs, mesmo gráfico, mesmo tom de alerta);
estados vazios com uma frase só; conflito de revisão; importação e exportação de cópias, e uma cópia com
movimentos aberta onde não há onde os guardar a dizer, na pergunta, que ficam de fora; dados fictícios que
não apagam os reais, que entram mesmo quando já existe um lote com a referência de um dos seus e que saem sem
levar o que é teu; as listas de delegação do lote e do dia com as onze do catálogo, e um registo antigo a
manter o nome que tinha; os três separadores do detalhe (clique, setas, Home e End) com os indicadores e o
filtro sempre por fora; o primeiro ecrã do painel só com o período, os indicadores, os avisos e os separadores,
com a produção por delegação e os movimentos num bloco à parte, logo a seguir; um único botão verde por vista, e nenhum no painel; o mês numa caixa de data só, com as
setas ‹ › coladas de cada lado e o calendário do sistema ao lado — sem uma segunda escolha do mesmo mês nem do
mesmo ano; o bloco dos motivos a
desaparecer nos períodos sem chumbadas no teste; a barra lateral a recolher e a voltar, com o rótulo certo;
o formulário do lote com cada fase encabeçada pelo próprio nome; o armazém a partir dos 25 itens do
contrato (escolher preenche nome, tipo, unidade, contratado e mínimo, e tranca-os; «Editar» abre-os; um artigo
que já existe abre trancado), e a saída «fora do contrato»; **um lado só**: o lote preparado chega ao dia
preenchido e trancado, «Editar» corrige o próprio lote no quadro e em todos os dias, a referência escrita à mão
puxa o lote em vez de criar uma cópia, o quadro segue os dias (e volta ao princípio quando o lote deixa de
estar apontado), um lote não se aponta duas vezes no mesmo dia, mudar a data passa a linha para o outro dia,
apagar um lote apontado deixa o dia a contar a produção sem ligação, e as notas que os formulários não mostram
(da entrada, da fase, do material) não se perdem numa correcção; os motivos por carta com quantidade por máquina, total por motivo, filtro,
«todas justificadas» e o painel a abri-los e a fechá-los; os 23 pontos de ajuda; mensagens de erro que dizem o que corrigir.

**Estático (`test-static.cjs`).** Só existem em `app/` os 44 ficheiros que a página carrega e usa (36 de código);
nenhum módulo de código passa dos 20 000 caracteres (o `app.js` desceu de 78 000 para cerca de 19 000); nenhum nome das
versões 1 e 2 nem a marca antiga voltaram ao código ou à documentação; o logótipo é vectorial (sem
rasterizados, sem texto, sem URLs), tem as três cores da marca e a mesma proporção no ecrã, na folha e no
PDF (`61,2` de altura por cada `100` de largura); as cores da marca são as mesmas no CSS, no PDF e no
logótipo; a ajuda só aparece quando pedida; `@page A4` e impressão isolada da aplicação; zero URLs externas;
e `docs/` só com o manual (9 páginas em PDF mais o Word, título e autor correctos, sem referência a guiões
internos) — os geradores vivem em `ferramentas/`, separados do que é entregue, e nenhuma pasta de trabalho
(`tmp/`, `output/`, `release_windows/`) fica no repositório. **O mapa** é o ficheiro da simplemaps.com tal como
veio, com a nota de direitos: onze províncias, as mesmas onze do catálogo (uma delegação em cada), cada uma com
o sítio onde se escreve o seu número; o código do mapa não tem pontos nem projecção de coordenadas; o bloco do
mapa começa abaixo do primeiro ecrã do painel.

**Datas (`test-static.cjs`, secção 7b).** Toda a data se escreve `dd/mm/aaaa` (`mm/aaaa` no mês); o `index.html`
não mostra nenhum campo com `type="date"`/`type="month"`; a caixa de data é a única peça que cria o calendário
do sistema (escondido dentro do controle), e as cinco vistas que escolhem datas usam-na — nenhuma inventa um
campo seu. Não há lista de meses que repita o que a caixa já diz.

**Servidor Node e base de dados (`tests/test-operations.cjs`, com `npm test`).** Cada teste corre numa base
temporária, pela API, como o ecrã faz. *Movimentos:* conservação das quantidades e despacho parcial; o
movimento do armazém escolhe o artigo da lista, soma nele na mesma gravação, e é o saldo dele que conta (sem
saídas a descoberto nem séries repetidas no mesmo artigo); movimentos fora de ordem, erros de lote e pedidos
mal feitos recusados com uma frase. *Um lado só:* os dias dizem do lote o que o lote diz, e corrigir o lote
corrige-os; a impressão e o teste de um lote apontado nos dias lêem-se de lá — os quatro movimentos que diriam
o mesmo são recusados com uma frase, e as aprovadas dos dias movem-se e despacham-se até onde os dias chegam;
os dias não ficam com menos aprovadas do que as já movidas (só a gravação que as baixa é travada); um lote que
anda pelos movimentos segue-os em tudo, e o que se tinha marcado à mão cede; a personalização que os movimentos
não registaram continua a ser a do lote; o ecrã não consegue dizer outra coisa de uma fase que tem dono. *Delegações:* as onze, as mesmas do ecrã; a produção por delegação tem sempre as onze
linhas, soma os nomes antigos na delegação certa, deixa à parte o nome que não reconhece, conta o lote pela
delegação que ele tem hoje e não conta a mesma carta duas vezes; o resumo é a soma das linhas. *Lotes e
artigos:* um lote ou um artigo apagado leva os seus movimentos e só esses (um movimento antigo do armazém, sem
artigo, fica); o dia que apontava o lote apagado continua a contar a produção; um lote não encolhe para menos
do que já tem personalizado. *Exemplo:* os movimentos entram e saem com os lotes e os artigos do exemplo,
inteiros; cada um seria aceite pelo servidor pela ordem em que está escrito, e deixa os lotes e o armazém
exactamente como o exemplo os traz — o exemplo já vem de acordo. *Cópias:* levam e trazem os movimentos com o estado, e uma cópia estragada não
muda nada. *Gravação:* revisão antiga e estado inválido recusados sem deixar rasto; com a base presa por outro
programa, a gravação é recusada com uma frase (503) e, libertada, grava como sempre; os acentos chegam inteiros
mesmo quando o pedido se parte a meio de uma letra. *Ficheiro:* a base fica num ficheiro só, completo depois
de cada gravação; uma base que a versão anterior deixou com os dados ao lado (WAL) é arrumada sem perder nada;
bases antigas abrem (sem a coluna da hora, ou com o documento de uma versão anterior), e uma base da versão
anterior fica de acordo ao abrir, uma vez e sem perder nada; uma base ilegível trava
o arranque com uma frase e o ficheiro fica igual, byte a byte; abrir o programa duas vezes dá uma explicação e
a segunda janela sai.

**Servidor Python (`tests/test_server.py`).** Ficheiro novo com lista vazia; `PUT` com revisão correcta e `409` com
a errada; rejeita JSON inválido, cópias de versão estranha e pedidos acima de 5 MB; `Host`/`Origin` de fora
do permitidos; caminhos de travessia e `dados/` nunca servidos; `POST /api/log` a gravar e o registo a
limitar-se em tamanho; base corrompida dá erro legível no arranque, sem reescrever nada.

## Estrutura do código (sem redundância)

O `app.js` deixou de ser um ficheiro de 78 000 caracteres: ficou com o arranque, a navegação, o desenho e a
gravação (cerca de 19 000) e o resto passou a módulos com um contrato só.

- `lib/` — regras e dados: `core` (cálculos e validação), `pdf`, `chart`, `period`, `side`, `store`
  (abrir e gravar, servidor ou navegador) e `base` (liga um módulo e falha alto se faltar uma peça).
- `components/` — peças que aparecem em mais do que um sítio: `ui` (elementos, datas, tiras, tabela),
  `pickdate` (a caixa de data: texto `dd/mm/aaaa` com o calendário do sistema dentro do mesmo controlo),
  `chips` (etiqueta de fase), `form` (diálogos), `table` (tabela do período), `filter` (mês/ano/intervalo),
  `feedback` (aviso, erro, confirmação, download, 🛈) e `zoom` (lupa).
- `views/` — cada ecrã e cada formulário: `panel`, `stock`, `lots`, `day` (o dia de produção: cabeçalho,
  tabela dos lotes, pé do dia e lista dos dias), `record-form` (o diálogo do lote), `lot-form`,
  `stock-form`, `reports`, `report-paper`, `files` (cópias e exemplo), `export` (PDF/CSV/impressão) e
  `wiring` (todos os eventos num só lugar). As gravações de um dia vivem numa peça só, `lib/daybook.js`:
  apontar um lote, concluir, reabrir, terminar e apagar o dia. As de um lote e de um artigo do armazém vivem
  noutra, `lib/lotbook.js`, que também sabe de onde vem cada fase de um lote.
- Um facto, um sítio: os dias e o quadro dos lotes ficam de acordo por uma regra só (`core.settle`), que o
  ecrã e o servidor correm em todas as gravações; a fase de um lote calcula-se num sítio só
  (`core.lotWithStages`), venha dos dias ou dos movimentos; os motivos do INCAPE, as máquinas e o contrato do material
  estão escritos uma vez (`core.REASONS`, `core.MACHINES`, `core.CATALOGUE`) e o servidor lê-os de lá; a
  fechadura dos três formulários é uma peça (`components/lock.js`).
- Uma regra, um sítio: a escolha de uma data (`components/pickdate.js`, ligada ao `ui.js` como `dateBox` e
  usada pelo filtro, pelos quatro campos do registo, pelas cinco do lote, pelas duas do material e por todos
  os relatórios — não há dois controlos para a mesma data, nem duas maneiras de mostrar uma data), o sinal
  dos números (`core.signed`), o título e o indicador da série de rejeição
  (`core.seriesFor`), as dez linhas da comparação (`core.comparisonRows`, usadas pelo papel e pelo PDF), o
  texto de uma fase de lote (`core.stageText`), a parte do total rejeitado (`core.rejectionShare`) e a
  leitura da taxa (`ui.rateClass`) não estão escritos duas vezes.
- O ecrã lê-se por uma peça só (`lib/dom.js`): não há um `document.getElementById` escrito em cada ficheiro.

## Verificações feitas à mão

- **Gráfico.** Desenhado por `app/chart.js` (SVG em texto, sem dependências): o mesmo desenho serve o painel,
  a folha do relatório e a lupa, com as cores da marca iguais às do CSS e do PDF.
- **PDF do relatório.** Desenhado por `app/pdf.js` com o logótipo oficial embutido (`inatro-letterhead.jpg`,
  JPEG tal e qual, sem recodificar): páginas A4, cabeçalho verde com a marca, rodapé com paginação dentro da
  margem. As folhas — produção, rejeição, motivos, lotes e armazém — abrem em leitores diferentes e
  a suite da interface confere assinatura `%PDF-`, `%%EOF`, número de páginas e a tabela própria de cada uma.
- **Manual.** Gerado a partir de uma só fonte (`ferramentas/gerar-manual.py`) em PDF e Word: capa com o
  cabeçalho institucional, índice, tabelas com cabeçalho verde, avisos âmbar, listas de verificação com
  caixas. As duas versões contam a mesma história da v6 (o dia com lotes).
- **Servidor a sério.** `python3 server.py --host 0.0.0.0 --port 8123 --allow-host e2b.app`, com `curl`:
  `/`, `style.css`, `pdf.js` e `chart.js` a devolverem `200`; `GET /api/state` com os 52 registos, 8 lotes e 25 artigos
  do contrato; `DELETE`/`PUT` com revisão velha a devolver `409`; `/dados/` `404`; os `404`/`403`/`409` a
  ficarem no registo como `WARN`.
- **Impressão.** Pré-visualização do navegador em A4: só sai a folha do relatório, sem menus nem botões.
- **A versão com uma delegação por província, num navegador a sério** (Chromium sem janela, contra
  `node backend/server.js` com uma base acabada de criar). Base vazia: a lista com as onze delegações a zero,
  o mapa sem números e sem pontos. «Ver com dados fictícios»: as onze províncias com tom e número, cada um
  igual ao da sua linha na lista, e o total a somar as linhas (33 116 produzidas, 15 950 aprovadas, 9000
  despachadas); 16 saldos de lote e o histórico. Clique numa província, clique numa linha e teclado a
  destacarem os dois lados; o período a filtrar e a arrumar datas trocadas. Movimentos: despacho recusado com
  erro de lote por resolver e aceite depois de resolvido, quantidade a mais, stock insuficiente, série repetida
  e falta de data, cada um com a sua frase. Lote novo a aparecer logo nos saldos, e a levar os movimentos
  quando é apagado; encolher um lote abaixo do que tem personalizado a ser recusado no próprio formulário.
  Cópia exportada com os movimentos, exemplo removido de uma vez e cópia importada a devolver tudo; uma cópia
  antiga, sem movimentos, a deixar os que existem. Sem erros na consola.
- **«Um lado só», num navegador a sério** (o mesmo Chromium, sobre o exemplo acabado de carregar). O lote
  apontado nos dias (EX-116) aparece nos saldos com 54 por imprimir, 96 a aguardar a conclusão e 250 prontas
  para mover, sem movimento nenhum; nos quatro movimentos de impressão e de teste fica desligado, com o porquê,
  e os outros lotes escolhem-se; mover 251 é recusado, mover 250 e despachar 100 é aceite, e o quadro mostra
  as quatro fases com a origem de cada uma. No dia: a lista oferece só os lotes por imprimir que não registam a
  impressão nos movimentos; o lote escolhido chega preenchido e trancado; guardado, o quadro segue-o e o lote
  todo impresso deixa de ser oferecido; a referência escrita à mão puxa o lote, e a de um lote com a impressão
  nos movimentos é recusada com uma frase; «Editar» corrige o lote no quadro e os saldos passam a ler os dias.
  Apagar a linha de um dia com cartas já movidas é recusado, e a linha continua lá. Uma entrada do armazém soma
  no artigo e a vista Armazém mostra-o sem recarregar; um artigo apagado leva os seus movimentos, e o contrato
  devolve-o preenchido e trancado. Corrigir as cartas do lote no quadro acerta o plano de cada dia.
- **Mutações.** 64 regras estragadas uma de cada vez (a tranca aberta, a impressão registada duas vezes, o dia
  que não segue o lote, o artigo que não soma, a nota que se perde, a base em WAL…): as suites dão por todas.
- **Código arrumado** (ferramentas corridas à parte; não ficam no projecto). ESLint sem avisos em `app/` e em
  `backend/`: nenhum nome por usar, nenhum por definir, nenhuma chave repetida. O detector de duplicados (blocos
  de 5 linhas ou mais) não encontra nenhum. Nenhuma classe do CSS fica sem uso.- **Tamanhos de ecrã.** De 3840×2160 a 390×844 (16 tamanhos): o bloco do mapa começa sempre abaixo do primeiro
  ecrã, a lista vê-se inteira (onze linhas e o total, sem barra própria), os números do mapa não se sobrepõem
  nem saem do desenho e a página não ganha barra horizontal. Com menos de 900 px de largura útil a lista passa
  para baixo do mapa; em telemóvel, as quatro colunas correm para o lado dentro da sua caixa, como as outras
  tabelas.
- **Servidor Python a sério com o ecrã novo** (`python3 server.py`, o do `.exe`, que não guarda movimentos): o
  bloco do mapa e dos movimentos não aparece; o exemplo entra e sai; a cópia exporta e importa; o lote escolhe
  entre as onze delegações; o lote preparado chega trancado ao dia, e o quadro segue o dia, com a regra a
  correr no próprio ecrã.
- **Exemplo coerente.** As 64 fases dos 16 lotes do exemplo (quadro dos Lotes) batem com os saldos: 56 seguem
  os movimentos, 2 os dias de produção e 6 marcam-se à mão; nenhum saldo é negativo.
- **Tabelas.** De 1920 a 1280 px de largura, as tabelas do Armazém, dos Lotes e dos Registos cabem no seu
  cartão, com os botões de cada linha à vista. Abaixo disso correm para o lado dentro do cartão.

## Fora do âmbito desta revisão

Não foi validado o uso com várias janelas abertas ao mesmo tempo (a regra é uma janela por computador; o `409`
existe para apanhar o restante): uma segunda janela, como a de uma TV, só mostra o que a primeira gravou depois
de recarregada. Em telemóvel só foram conferidos o primeiro ecrã do painel e o bloco do mapa e dos movimentos;
nas outras vistas, a essa largura, há cabeçalhos e a folha do relatório que ainda passam da margem.
O servidor Python (`.exe`) não guarda movimentos. Os testes não cobrem o desenho do PDF em navegadores antigos, nem a comparação com mais de 14
períodos (o gráfico continua a mostrar só os últimos 14, como no painel).
