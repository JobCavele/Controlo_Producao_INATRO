# Verificação do projecto

Quatro suites automáticas, todas sem rede e sem browser: o núcleo, a interface (num DOM mínimo), as
verificações estáticas ao que é servido e o servidor com base de dados. Usam exclusivamente números
fictícios e bases temporárias — nenhum toque em `dados/`.

```text
node tests/test-core.cjs      # 17 secções: datas, cálculos, validação, migração, CSV, comparação
node tests/test-ui.cjs        # 20 secções: painel, filtros (mês/ano/período), formulário, relatórios, comparação, PDF, CSV, cópias, ajuda
node tests/test-static.cjs    # 11 secções: ficheiros, marca e logótipo, ajuda, erros, impressão, rede, docs
python3 -m unittest discover -s tests -p "test_*.py"   # 14 testes: estado, revisões, cópias, limites, logs
```

## O que cada suite segura

**Núcleo (`test-core.cjs`).** Datas inválidas e anos bissextos; intervalos de mês e de semana; percentagens
com zero denominador; `produzidas − rejeitadas` como aprovadas; um registo só conta se couber inteiro no
período; sobreposições recusadas; limites de quantidade e de notas; migração de cópias v1 e v2; CSV com BOM,
`;` e células à prova de fórmulas. Na comparação: a sequência de meses ou de anos, o limite de 36 meses e
12 anos, `Só o primeiro e o último`, a variação (cartas e pontos de taxa) período a período, o total
comparado e o CSV próprio da comparação.

**Interface (`test-ui.cjs`).** Os 65 `id` usados pelo código existem no HTML; guardar, editar e eliminar;
o formulário salta para o período registado; os três modos do filtro — mês, ano (média mensal no KPI e doze
barras no gráfico) e intervalo — e a linha «face ao período anterior», que só aparece quando o período
anterior tem números; a comparação de meses e de anos no papel, com a tabela, o total e a leitura escrita;
a pré-visualização do relatório igual ao PDF (mesma marca, mesmos KPIs, mesmo gráfico, mesmo tom de alerta);
estados vazios com uma frase só; conflito de revisão; importação e exportação de cópias; dados fictícios que
não apagam os reais; as 15 caixas de ajuda; mensagens de erro que dizem o que corrigir.

**Estático (`test-static.cjs`).** Só existem em `dist/` os 9 ficheiros que a página carrega; nenhum nome das
versões 1 e 2 nem a marca antiga voltaram ao código ou à documentação; o logótipo é vectorial (sem
rasterizados, sem texto, sem URLs), tem as três cores da marca e a mesma proporção no ecrã, na folha e no
PDF (`61,2` de altura por cada `100` de largura); as cores da marca são as mesmas no CSS, no PDF e no
logótipo; a ajuda só aparece quando pedida; `@page A4` e impressão isolada da aplicação; zero URLs externas;
e `docs/` só com o manual (13 páginas, título e autor correctos, sem referência a guiões internos) —
nenhuma pasta de auxílio (`tools/`, `refs/`, `tmp/`) fica no repositório.

**Servidor (`tests/test_server.py`).** Ficheiro novo com lista vazia; `PUT` com revisão correcta e `409` com
a errada; rejeita JSON inválido, cópias de versão estranha e pedidos acima de 5 MB; `Host`/`Origin` de fora
do permitidos; caminhos de travessia e `dados/` nunca servidos; `POST /api/log` a gravar e o registo a
limitar-se em tamanho; base corrompida dá erro legível no arranque, sem reescrever nada.

## Verificações feitas à mão

- **PDF do relatório.** Gerado por `dist/pdf.js` e aberto com MuPDF: páginas A4 sem erros, a marca
  vectorial legível a 12 pt (arco do velocímetro, agulha e estrada em perspectiva, sem fontes nem imagens
  embebidas), rodapé «Página 1 de N» dentro da margem. O relatório de comparação de quatro meses sai em
  duas páginas, com a tabela, o total e a leitura por baixo — provado na suite da interface.
- **Logótipo.** `dist/conta-carta-mark.svg` e o `contaCartaMark` de `dist/pdf.js` partem das medidas do
  símbolo da instituição (grelha 100 × 61,2). Renderizado a 100 dpi e comparado com a imagem original: arco
  com as doze marcas de cor, estrada cinzenta em perspectiva com os três traços, agulha e cubo.
- **Servidor a sério.** `python3 server.py --host 0.0.0.0 --port 8000 --allow-host e2b.app`, com `curl`:
  `/`, `conta-carta-mark.svg` (`image/svg+xml`), `style.css` e `pdf.js` a devolverem `200`;
  `GET /api/state` (revisão 1) → `PUT` com a revisão certa (`200`, passa a 2) → `PUT` repetido com a revisão
  velha (`409` com a mensagem de recarregar) → `GET` a devolver o registo escrito; `/dados/` `404`;
  `Origin` alheio `403`; os `404`/`403`/`409` a ficarem no registo como `WARN`.
- **Manual.** Documento entregue em `docs/`, sem scripts de produção no repositório. Cada página foi
  renderizada a 100 dpi e lida: capa, índice com pontilhado e números correctos, figuras sem sobreposições,
  tabelas dentro da mancha, sem caracteres em falta; a mancha não passa de `x = 573` nem da linha dos
  `811` pontos. A verificação automática fica reduzida ao que o PDF permite provar sem o gerar: cabeçalho,
  fim de ficheiro, 13 páginas e as metadagens de título e autor.
- **Impressão.** Pré-visualização do navegador em A4: só sai a folha do relatório, sem menus nem botões.

## Fora do âmbito desta revisão

Não foi validado visualmente o comportamento responsivo em telemóvel nem o uso com várias janelas abertas em
computadores diferentes ao mesmo tempo (a regra é uma janela por computador; o `409` existe para apanhar o
restante). Os testes não cobrem o desenho do PDF em navegadores antigos, nem a comparação com mais de 14
períodos (o gráfico continua a mostrar só os últimos 14, como no painel).
