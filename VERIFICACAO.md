# Verificação do projecto

Quatro suites automáticas, todas sem rede e sem browser: o núcleo, a interface (num DOM mínimo), as
verificações estáticas ao que é servido e o servidor com base de dados. Usam exclusivamente números
fictícios e bases temporárias — nenhum toque em `dados/`.

```text
node tests/test-core.cjs      # 26 secções: datas, cálculos, lotes do dia, motivos, armazém, migração, CSV
node tests/test-ui.cjs        # 38 secções: dia de produção, painel, armazém, lotes, formulário, relatórios, comparação, PDF, CSV, cópias, ajuda, 117 ids
node tests/test-static.cjs    # 13 secções: ficheiros, marca e logótipo, ajuda, erros, datas, impressão, rede, docs, mapa
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
rejeição, o CSV leva as linhas `Etiqueta` (número) e `Nome` (por extenso).

**Interface (`test-ui.cjs`).** Os 117 `id` usados pelo código existem no HTML; **o dia de produção**: apontar o
primeiro lote, o segundo na outra máquina, um lote que fica em curso («Lote concluído» desmarcado) e se conclui
na linha do dia, o cabeçalho com os números somados dos lotes, a lista dos dias com o ano, «Terminar dia» e
«Reabrir o dia»; concluir um lote chega para o painel do mês contar o dia, sem mais nenhum passo; guardar, editar e eliminar;
 os três modos do filtro — mês, ano (média mensal no KPI e doze
barras no gráfico) e intervalo — e a linha «face ao período anterior», que só aparece quando o período
anterior tem números; a comparação de meses e de anos no papel, com a tabela lado a lado, a diferença e a leitura escrita;
as vistas do Armazém e dos Lotes (KPIs, tabelas, filtros, diálogos e gravação sem perder os outros dados);
os relatórios de motivos, lotes e armazém, com tabela, CSV e PDF próprios; a barra de alertas do Painel;
a pré-visualização do relatório igual ao PDF (mesma marca, mesmos KPIs, mesmo gráfico, mesmo tom de alerta);
estados vazios com uma frase só; conflito de revisão; importação e exportação de cópias; dados fictícios que
não apagam os reais; os três separadores do detalhe (clique, setas, Home e End) com os indicadores e o
filtro sempre por fora; o primeiro ecrã do painel só com o período, os indicadores, os avisos e os separadores,
com a produção por delegação e os movimentos num bloco à parte, logo a seguir; um único botão verde por vista, e nenhum no painel; o mês numa caixa de data só, com as
setas ‹ › coladas de cada lado e o calendário do sistema ao lado — sem uma segunda escolha do mesmo mês nem do
mesmo ano; o bloco dos motivos a
desaparecer nos períodos sem chumbadas no teste; a barra lateral a recolher e a voltar, com o rótulo certo;
o formulário do lote com cada fase encabeçada pelo próprio nome; o armazém a partir dos 25 itens do
contrato (escolher preenche nome, tipo, unidade, contratado e mínimo), com o nome em leitura e um botão para
o corrigir, e a saída «Outro»; os motivos por carta com quantidade por máquina, total por motivo, filtro,
«todas justificadas» e o painel a abri-los e a fechá-los; as 20 caixas de ajuda; mensagens de erro que dizem o que corrigir.

**Estático (`test-static.cjs`).** Só existem em `app/` os 37 ficheiros que a página carrega e usa (30 de código);
nenhum módulo de código passa dos 20 000 caracteres (o `app.js` desceu de 78 000 para cerca de 19 000); nenhum nome das
versões 1 e 2 nem a marca antiga voltaram ao código ou à documentação; o logótipo é vectorial (sem
rasterizados, sem texto, sem URLs), tem as três cores da marca e a mesma proporção no ecrã, na folha e no
PDF (`61,2` de altura por cada `100` de largura); as cores da marca são as mesmas no CSS, no PDF e no
logótipo; a ajuda só aparece quando pedida; `@page A4` e impressão isolada da aplicação; zero URLs externas;
e `docs/` só com o manual (8 páginas em PDF mais o Word, título e autor correctos, sem referência a guiões
internos) — os geradores vivem em `ferramentas/`, separados do que é entregue, e nenhuma pasta de trabalho
(`tmp/`, `output/`, `release_windows/`) fica no repositório. **O mapa** é o ficheiro da simplemaps.com tal como
veio, com a nota de direitos: onze províncias, a projecção a devolver os pontos de referência do próprio ficheiro e
as 27 delegações do catálogo dentro da sua província; o bloco do mapa começa abaixo do primeiro ecrã do painel.

**Datas (`test-static.cjs`, secção 7b).** Toda a data se escreve `dd/mm/aaaa` (`mm/aaaa` no mês); o `index.html`
não mostra nenhum campo com `type="date"`/`type="month"`; a caixa de data é a única peça que cria o calendário
do sistema (escondido dentro do controle), e as cinco vistas que escolhem datas usam-na — nenhuma inventa um
campo seu. Não há lista de meses que repita o que a caixa já diz.

**Servidor (`tests/test_server.py`).** Ficheiro novo com lista vazia; `PUT` com revisão correcta e `409` com
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
  apontar um lote, concluir, reabrir, terminar e apagar o dia, e ainda marcar as fases do lote no quadro.
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

## Fora do âmbito desta revisão

Não foi validado visualmente o comportamento responsivo em telemóvel nem o uso com várias janelas abertas em
computadores diferentes ao mesmo tempo (a regra é uma janela por computador; o `409` existe para apanhar o
restante). Os testes não cobrem o desenho do PDF em navegadores antigos, nem a comparação com mais de 14
períodos (o gráfico continua a mostrar só os últimos 14, como no painel).
