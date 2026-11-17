# Conta Carta · produção de cartas de condução — INATRO, IP

Aplicação local que acompanha a carta de condução do princípio ao fim: produção e rejeições das duas
máquinas, motivos de rejeição do INCAPE, lotes (personalização → impressão → qualidade → despacho) e o
material do armazém, incluindo o quadro do contrato (contratado, entregue, por entregar, dado).

Escreve-se pouco: as aprovadas, as taxas, os totais, os gráficos e o relatório são calculados.

## Iniciar

Precisas de Python 3.9 ou superior. Não instala nada, não acede à internet.

1. Abre uma janela nesta pasta.
2. Executa `python3 server.py` (Windows: `py -3 server.py`, ou duplo-clique em `Iniciar_Windows.bat`).
3. Vai a <http://localhost:8000> e deixa a janela do servidor aberta.
4. Porta ocupada: `python3 server.py --port 8001`.
5. Outro computador da sala precisa de ver o mesmo: `python3 server.py --host 0.0.0.0 --allow-host nome.interno`.

No primeiro arranque não há registos. O botão «Ver com dados fictícios» (barra lateral) carrega um ano de
exemplo — 52 dias com 86 lotes, 8 lotes no quadro e os 25 artigos do contrato — e o mesmo botão retira-o.

O trabalho do dia faz-se todo na vista **Registos**: «Adicionar lote» aponta a produção, as rejeições da
máquina e as chumbadas no teste de cada lote, à medida que saem; «Terminar dia» fecha a conta. Cada lote pode
ficar «em curso» e concluir-se depois. Um lote concluído conta logo no painel e nos relatórios.

## Pastas

```text
app/          a aplicação publicada: HTML, CSS, imagens, dados de exemplo e o código em três pastas
  app.js        o arranque: abre os dados, liga as peças e desenha
  lib/          as regras e os dados (core, daybook, pdf, chart, period, side, store, dom, base)
  components/   as peças que aparecem em mais do que um sítio (ui, pickdate, chips, form, table, filter, feedback, zoom)
  views/        cada ecrã e cada formulário (painel, armazém, lotes, dia, relatórios, cópias, exportações)
assets/       marca e ícones do executável (+ assets/manual, saída do gerador do manual)
ferramentas/  geradores de desenvolvimento (o manual em PDF e Word)
docs/         documentos entregues: manual do utilizador em PDF e Word
tests/        as quatro suites automáticas e os dados fictícios partilhados
server.py     o servidor local (biblioteca padrão de Python, zero dependências)
```

`dados/` (a base SQLite), `release_windows/` (o `.exe` compilado) e os registos de erro nascem ao lado e
nunca entram no repositório.

## Onde ficam os dados

Em `dados/contacarta.sqlite3`, criado automaticamente ao lado desta pasta. O `.gitignore` exclui a pasta
`dados/`, as bases de dados, os registos de erro (`*.log`), as pastas de trabalho (`tmp/`, `output/`) e os
executáveis compilados — nada de produção entra no repositório.

## Verificar

```text
node tests/test-core.cjs
node tests/test-ui.cjs
node tests/test-static.cjs
python3 -m unittest discover -s tests -p "test_*.py"
```

Nada disto precisa de rede nem de navegador. Ver `VERIFICACAO.md` para o que cada suite segura.

## Regerar o manual

```text
python3 ferramentas/gerar-manual.py
```

Precisa de `reportlab` e `python-docx` (só para o manual; a aplicação não usa nenhum dos dois). Escreve
`assets/manual/manual-do-utilizador.pdf` e `.docx` — os entregáveis copiam-se depois para `docs/`.
