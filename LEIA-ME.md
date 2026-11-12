# Controlo de produção de cartas de condução

Aplicação local para registar a produção das duas máquinas, acompanhar a qualidade e gerar relatórios diários, semanais e mensais.

## Iniciar

É necessário Python 3.9 ou superior, sem pacotes adicionais.

1. Clona ou extrai o projecto.
2. Na pasta do projecto, executa `python server.py` (Windows: também `py -3 server.py`; Linux/macOS: `sh iniciar.sh`).
3. Abre http://localhost:8000 e mantém o servidor aberto.
4. Se a porta estiver ocupada, usa `python server.py --port 8001`.

O atalho `Iniciar_Windows.bat` usa a cópia portátil quando disponível localmente; a pasta `python/` não é distribuída pelo Git.

## Dados

Uma instalação nova começa sem registos. `dist/seed.json` contém apenas a estrutura vazia. A base SQLite é criada automaticamente em `dados/cartas.sqlite3`.

A pasta `dados/`, cópias, PDFs gerados, logs, temporários e ficheiros `.env` são excluídos pelo `.gitignore`. Alterar o seed não apaga bases de dados locais existentes. Não publiques dados reais nem cópias JSON no repositório.

## Registar produção

Preenche produzidas e rejeitadas por máquina. Campos vazios contam como zero. O sistema calcula aprovadas (produzidas menos rejeitadas) e os totais. Rejeitadas não podem ultrapassar produzidas. Só pode existir um registo diário por data.

## Consultar e exportar

- Visão geral: filtros por intervalo ou mês, gráfico por máquina e resultados globais.
- Registo diário: calendário e histórico com edição e eliminação.
- Relatórios: periodicidade diária, semanal ou mensal, exportação CSV e impressão/guardar PDF.
- Exportar dados / Importar cópia: cópia JSON e restauro. A importação substitui os dados actuais após confirmação.

Registos diários e relatórios agregados são consultados separadamente para evitar duplicações. Dias sem registo são indicados na cobertura. Relatórios sobrepostos bloqueiam a soma e a exportação. Totais históricos importados são preservados e diferenças são sinalizadas.

## Testes

```text
node tests/test-core.cjs
node verify-dashboard.cjs
python -m unittest discover -s tests -p "test_*.py"
```

Os testes usam quantidades fictícias em `tests/fixtures/synthetic.json`, nunca carregadas na aplicação. Os testes do servidor usam uma base temporária isolada.
