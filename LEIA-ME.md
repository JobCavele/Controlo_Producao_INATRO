# Conta Carta · registo de producção de cartas — INATRO, IP

Aplicação local para apontar o que as duas máquinas de cartas de conducção produzem e deitam fora.
Registas produzidas e rejeitadas; o resto — aprovadas, totais, percentagens, gráficos e relatório — é calculado.

## Iniciar

Precisas de Python 3.9 ou superior. Não instala nada, não acede à internet.

1. Abre uma janela nesta pasta.
2. Executa `python3 server.py` (Windows: `py -3 server.py`, ou duplo-clique em `Iniciar_Windows.bat`).
3. Vai a <http://localhost:8000> e deixa a janela do servidor aberta.
4. Porta ocupada: `python3 server.py --port 8001`.
5. Outro computador da sala precisa de ver o mesmo: `python3 server.py --host 0.0.0.0 --allow-host nome.interno`.

No primeiro arranque não há registos. O botão «Ver com dados fictícios» (na barra lateral) carrega um
período de exemplo para demonstrar o painel; remove-se com o mesmo botão.

## Marca

`dist/conta-carta-mark.svg` é o logótipo (arco de velocímetro com as doze marcas de cor, estrada em
perspectiva, agulha), desenhado a partir das medidas do símbolo da instituição. O relatório desenha a mesma
geometria em vectores (`contaCartaMark` em `dist/pdf.js`), por isso o símbolo serve para o ecrã, para a
impressão e para o papel sem levar imagens nem fontes.

## Onde ficam os dados

Em `dados/contacarta.sqlite3`, criado automaticamente ao lado desta pasta. O `.gitignore` exclui a pasta
`dados/`, as bases de dados, os registos de erro (`*.log`) e as pastas de trabalho (`tmp/`, `output/`) —
nada de producção entra no repositório.

Cada computador guarda os seus registos. «Exportar cópia» escreve um `.json` com tudo; «Importar cópia»
substitui o que está no computador pelo ficheiro, depois de confirmar. Cópias de versões antigas são
convertidas ao importar.

## Manual do utilizador

`docs/manual-do-utilizador.pdf` é o manual em A4: introducção, pré-requisitos, glossário, acesso, as
três vistas, relatórios (incluindo a comparação de meses e de anos), cópias de segurança, mensagens do
ecrã e dois anexos (lista de verificação do turno e ficha técnica). Está em versão 1.4, 13 páginas, com
índice automático. É o único ficheiro em `docs/`: a aplicação e o manual são tudo o que o projecto entrega.

## Usar

- **Painel** — três modos de filtro: mês, ano ou intervalo de datas. KPIs, números por máquina, gráfico de
  evolução e o detalhe do período. Com o período anterior apontado, cada KPI diz também a variação
  («+360 face ao mês anterior»); no modo ano o primeiro número passa a média mensal.
- **Registos** — tudo o que foi apontado, filtrado por ano, com editar e eliminar.
- **Relatórios** — dia, semana, mês, período, *comparar meses* ou *comparar anos*; pré-visualização em A4,
  exportar PDF, exportar CSV ou imprimir. A comparação põe cada período em linha (até 36 meses ou 12 anos,
  ou só as duas pontas do intervalo), soma-os, mostra a variação de um para o outro, marca a melhor e a pior
  taxa e escreve uma frase de leitura por baixo; sai igual no papel, no PDF e no CSV.
- **Novo registo** — dia (um turno), mês (fechar o mês) ou vários dias (semana, pausa). Duas máquinas, dois campos cada.

Regras que o sistema não deixa contornar: um dia só pode ter um registo (nada se conta duas vezes), as
rejeitadas não podem exceder as produzidas, e um registo só entra num período se couber inteiro nele.
Os campos de ajuda estão nos 🛈. Um registo nunca é repartido entre dois períodos comparados: ou cabe
inteiro num, ou não conta.

## Testes

```text
node tests/test-core.cjs      # datas, cálculos, validação, migração, CSV
node tests/test-ui.cjs        # a interface completa, num DOM mínimo
node tests/test-static.cjs    # ficheiros, marca, ajuda, impressão, rede
python3 -m unittest discover -s tests -p "test_*.py"
```

Os testes usam exclusivamente números fictícios (`tests/fixtures/synthetic.json`) e uma base temporária;
nunca tocam em `dados/`.
