# Conta Carta — versão Node.js + SQLite

## Arranque no Windows

1. Instalar **Node.js 22.13 ou superior** a partir de https://nodejs.org/ (a funcionalidade SQLite nativa requer Node.js moderno).
2. Encerrar todas as janelas antigas do Conta Carta e **fazer uma cópia de segurança de `dados/contacarta.sqlite3`**.
3. Extrair o ZIP e fazer duplo clique em `Iniciar_Windows.bat`.
4. Abrir `http://localhost:8000` caso a janela não se abra automaticamente.

Na pasta do projecto, também é possível executar `npm start`. **Não existem dependências externas npm**; `npm install` não é necessário.

## Organização

- `backend/server.js`: servidor HTTP e rotas da API;
- `backend/shared/database.js`: inicialização e ligação SQLite;
- `backend/shared/http.js`: validação e respostas HTTP;
- `backend/modules/delegations.js`: catálogo indicativo de delegações e coordenadas;
- `backend/modules/operations.js`: registo de quantidades, limites e indicadores;
- `app/lib/`: núcleo e ferramentas herdados do sistema original;
- `app/views/operations.js`: produção por delegação, formulário de movimentos, saldos e histórico;
- `app/components/map.js`: mapa interactivo das províncias e das delegações;
- `app/mocambique.svg`: desenho das províncias, da simplemaps.com, tal como foi publicado;
- `app/views/`: restantes vistas existentes;
- `tests/`: testes automatizados.

## Regras operacionais

O formulário **Fluxo operacional por quantidades** fica no Painel, por baixo do primeiro ecrã: desce-se com o scroll, a seguir à **Produção por delegação**. O primeiro ecrã do Painel, o que se vê na TV, tem só o período, os indicadores e os separadores Máquinas, Gráfico e Registos. O formulário controla personalização, impressão, aprovação no QC, movimentação para despacho e despacho parcial. A introdução segue a ordem cronológica e as quantidades não podem exceder os saldos disponíveis.

- Impressões e reimpressões são tentativas; rejeições regressam à fila de impressão.
- Uma carta aprovada apenas poderá seguir para despacho depois de movimentada para a respectiva área.
- Um erro de lote por resolver impede o despacho.
- As rejeições QC exigem um motivo do INCAPE; a lista «Outro» é uma categoria local provisória.
- Os campos de série permitem registar intervalos numéricos; cada intervalo deve coincidir com a quantidade e não pode repetir outro intervalo de igual tipo.
- Os movimentos são imutáveis na interface, para preservar o histórico. Correcções requerem um procedimento administrativo ainda por definir.

## Importante acerca dos dados anteriores

A aplicação **não apaga o documento SQLite antigo**, preservando os lotes, materiais e registos já guardados. Os movimentos operacionais novos são armazenados na tabela adicional `operations` da mesma base. Os registos anteriores de produção com delegação identificada aparecem no mapa; como não tinham as datas e saldos de cada fase separados, não são automaticamente convertidos em movimentos QC ou despacho.

O quadro de etapas anterior é histórico/legado; para decisões de saldo e despacho deve usar-se o quadro novo **Saldos por lote**. A migração total dos movimentos antigos requer reconciliação manual para não presumir que todos os lotes foram aprovados ou enviados.

As coordenadas e os nomes das delegações no catálogo inicial são **indicativos, sujeitos a confirmação pelo INATRO**. O desenho das províncias é o da simplemaps.com (`app/mocambique.svg`, com a nota de direitos de origem, que permite o uso): serve para visualização, não é cartografia oficial nem cadastral. Só entram no mapa as delegações do catálogo; um nome escrito de outra maneira num registo antigo aparece na lista ao lado do mapa, mas não em nenhum ponto. O mapa funciona sem ligação à Internet.

## Testes

```powershell
npm test
node tests/test-core.cjs
node tests/test-ui.cjs
node tests/test-static.cjs
```

Os testes operacionais cobrem limites de saldo, despacho parcial, reimpressões, entradas/saídas do armazém e intervalos sobrepostos. Os estáticos conferem o mapa: as onze províncias do ficheiro original e cada delegação do catálogo dentro da sua província.

## Segurança

Este servidor está limitado a `127.0.0.1`, para utilização local. A versão não fornece autenticação nem acesso multiutilizador remoto. Não a publique na rede ou na Internet sem autenticação, permissões, HTTPS e testes de concorrência adicionais.

## Endpoints

- `GET /api/state`, `PUT /api/state`: compatibilidade com a aplicação anterior e revisão optimista;
- `GET /api/delegations`: catálogo de delegações;
- `GET /api/operations`: saldos, movimentos e produção por delegação (filtros `start`, `end`);
- `POST /api/operations`: novo movimento validado.
