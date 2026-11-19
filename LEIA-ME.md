# Conta Carta — INATRO, IP

Sistema de consulta e registo manual de quantidades de cartas de condução. A aplicação utiliza **HTML, CSS e JavaScript**, tanto na interface como no servidor. A base de dados é **SQLite**. Não utiliza Python, scripts `.sh`, ficheiros `.bat` ou armazenamento no navegador.

## 1. Como iniciar

1. Instale o [Node.js](https://nodejs.org/) 22.13 ou superior (recomendado: versão LTS actual).
2. Abra um terminal na pasta deste projecto.
3. Na **primeira utilização**, configure as duas contas:

   ```bash
   npm run setup
   ```

   O programa solicita duas palavras-passe (mínimo de 6 caracteres): uma para **PCA** e outra para **Fábrica**. Guarde-as de forma segura. A configuração não precisa de ser repetida a cada arranque.

4. Inicie a aplicação:

   ```bash
   npm start
   ```

5. Abra **http://localhost:8000** no navegador e escolha o perfil correspondente.

Não é necessário executar `npm install`: o sistema utiliza apenas módulos incluídos no Node.js.

### Perfis

| PCA | Fábrica |
| --- | --- |
| Consulta exclusivamente a visão geral, incluindo filtros, indicadores, máquinas e mapa por delegação. | Consulta o painel e introduz, pesquisa, corrige, elimina e exporta registos. |
| Não pode ler os registos detalhados nem alterar dados através da API. | As alterações ficam num histórico interno de auditoria. |

As sessões expiram após 12 horas. A leitura do painel actualiza-se automaticamente a cada 60 segundos enquanto a página estiver visível. Também existe o botão **Actualizar**.

No gráfico de evolução, o eixo horizontal mostra o dia ou mês e o eixo vertical mostra a quantidade. Em **Gráfico**, escolha **Barras** ou **Linhas**. Para apresentar o painel numa televisão, escolha o período, carregue em **Aplicar** e depois em **Modo TV**. A apresentação começa com os seis cartões nacionais, passa à **produção por máquina**, ao **gráfico de evolução** no tipo escolhido e depois ao mapa, que destaca uma sede de cada vez. A cada **5 segundos**, passa suavemente ao slide seguinte. Depois da última sede, voltam os cartões. A Cidade de Maputo e a província de Maputo (Matola) têm slides separados. Em **Intervalo** pode escolher **15 s** ou **Pausa**, sem interromper a actualização dos dados. Se o mapa estiver indisponível, alternam os cartões nacionais, as máquinas e o gráfico.

Se o navegador não permitir ecrã inteiro, a apresentação usa toda a janela. **Sair do modo TV** ou **Esc** repõe o painel com a selecção anterior do mapa. Fora desse modo, a **seta dupla** no topo da barra lateral permite recolhê-la para uma faixa de ícones. Os atalhos continuam a funcionar; carregue na seta invertida para voltar a ver os nomes.

## 2. Rotina diária da fábrica

1. **Por produzir (INCAPE):** consultar manualmente o número pendente para cada delegação e guardar a quantidade com a data da consulta. O painel mostra a última consulta até à data final e desconta apenas os registos de produção criados depois dessa consulta. Produções que já existiam antes da consulta não são descontadas. Para actualizar a consulta do mesmo dia, corrige-se o registo no Histórico.
2. **Produção e QC:** num único registo por data, delegação e máquina 1 ou 2, introduzir produzidas, rejeitadas pela máquina e reprovadas definitivamente no QC. As aprovadas são calculadas pelo sistema: **produzidas − reprovadas no QC**. As rejeitadas pela máquina são apenas uma indicação e não são subtraídas novamente. Exemplo fictício: 50 produzidas, 10 rejeitadas pela máquina e 5 reprovadas no QC resultam em 45 aprovadas. O QC pode reprovar mais ou menos do que a máquina indicou, mas não mais do que foi produzido.
3. **Histórico de QC separado:** registos antigos permanecem consultáveis e corrigíveis em **QC antigo**. Novos registos já incluem QC na produção. Se existir QC antigo para a mesma combinação, o sistema bloqueia a gravação em duplicado em vez de alterar os dados antigos automaticamente.
4. **Despacho:** registar o número total de cartas enviadas por data e delegação. O sistema impede despachar mais do que as cartas aprovadas no QC para essa delegação até à data do despacho, descontando os despachos já registados. Aprovações de outra delegação ou de uma data futura não aumentam esse saldo, e produção ainda sem QC não fica disponível. Ao corrigir um despacho, a quantidade anterior é substituída, sem desconto em duplicado. Correcções e eliminações da produção ou do QC também não podem deixar sem cobertura despachos já guardados.
5. **Consultar o painel:** escolher o mês, ano ou intervalo de datas. Cada indicador mostra quando o seu grupo de informações foi actualizado.

Em **Cartas por delegação**, cada uma das 11 delegações tem a mesma cor no mapa e no quadrado junto ao seu nome na tabela. Em **Cor por**, escolha produzidas (por defeito), pendentes do último INCAPE até à data final, QC aprovadas ou despachadas. O número e a cor usam apenas essa coluna. Zero ou ausência de registo ficam a cinzento; nas pendentes, **—** significa que não há consulta. Quanto maior a quantidade, mais escuro o verde. A mesma quantidade mantém a cor entre períodos, mesmo que só uma delegação tenha registos. A legenda mostra exemplos de valores do período.

No sul, a área principal representa **Maputo** e a etiqueta lateral representa a **Matola**, cada qual com os seus próprios valores. Passe o rato sobre uma área ou use a tecla Tab para consultar os valores. Seleccionar uma área ou um nome mantém a caixa de valores visível ao retirar o rato, sem esconder as restantes delegações nem alterar o total. Seleccionar de novo ou usar **Limpar selecção** retira o destaque.

Nos formulários, na API, na base SQLite e nos relatórios, as datas usam **dd/mm/aaaa**: `03/04/2026` significa **3 de Abril**, não 4 de Março. Quando só se escolhe o mês, usa-se `mm/aaaa`; para o ano, `aaaa`. Nos três ecrãs, os calendários e os avisos de data são em português, independentemente do idioma do dispositivo. Pode seleccionar o dia ou escrever os oito algarismos seguidos. **Hoje** e as horas referem-se a Maputo (UTC+02:00).

O relatório impresso ou guardado em PDF inclui o período aplicado ao painel e a data e hora da impressão. Se o navegador acrescentar outro cabeçalho com a data do sistema, desactive a opção **Cabeçalhos e rodapés** no diálogo de impressão. No Histórico, **Descarregar CSV** exporta a data do registo e a da última actualização no mesmo formato. Apenas no **nome do ficheiro** se usam hífens (`dd-mm-aaaa`), porque a barra é um separador de pastas. Se uma folha de cálculo inverter dia e mês ao abrir o CSV, importe as colunas de data como **dia/mês/ano** ou **texto**: o CSV não define as preferências da folha.

Uma combinação de **data + delegação** (e, na produção/QC, **máquina**) identifica um registo diário. Para corrigir os valores de um registo existente, vá a **Histórico e correcções → Corrigir**. Isso evita duplicar totais por engano. Os despachos do mesmo dia para a mesma delegação devem ser somados manualmente e introduzidos como total diário.

## 3. Base de dados e cópias de segurança

Os registos são guardados na pasta `dados/`, no ficheiro `contacarta.sqlite3`, criado automaticamente. **O navegador não guarda os dados em localStorage.** Todos os números apresentados provêm da base de dados SQLite, através da API.

Tabelas operacionais:

| Tabela | Conteúdo |
| --- | --- |
| `delegations` | Catálogo das delegações e pontos indicativos no mapa. |
| `pending_snapshots` | Quantidades por produzir, por data e delegação. |
| `production_entries` | Produção, indicação de rejeição da máquina e reprovação QC por data, delegação e máquina; aprovadas calculadas. |
| `quality_entries` | Histórico anterior de QC separado, preservado; máquina 0 = não identificada. |
| `dispatch_entries` | Total diário despachado por delegação. |
| `users`, `sessions` | Credenciais protegidas e sessões temporárias. |
| `audit_log` | Histórico das alterações, com valores anteriores e novos. |

As operações são validadas e executadas em transacções. Cada correcção exige a última revisão do registo, de forma a prevenir sobreposições entre duas pessoas. O SQLite utiliza o modo WAL para melhorar a leitura durante as gravações.

**Cópia de segurança:** pare o servidor e copie o ficheiro `dados/contacarta.sqlite3` para outro local seguro. Se a aplicação estiver em funcionamento, faça uma cópia de segurança SQLite consistente; não copie isoladamente o ficheiro principal enquanto existirem ficheiros WAL.

**Ao actualizar uma instalação existente:** pare a versão anterior e faça essa cópia **antes** de abrir a base na nova versão. Na primeira abertura, a aplicação converte as datas dos registos, da auditoria e das sessões numa única transacção. As datas dos registos mantêm o mesmo dia; os instantes passam de UTC para a hora equivalente de Maputo, incluindo os milissegundos. Em caso de erro a transacção é anulada. Não volte a abrir a base convertida com a versão antiga; para recuar, restaure a cópia.

## 4. Organização do projecto

A referência é a [v3 de Muhadil na branch `crazystuff` (`4478aab`)](https://github.com/JobCavele/Controlo_Producao_INATRO/commit/4478aab0a23195ce53f8599e4212d3ccb66bf2ed). `backend/server.js` serve os ficheiros públicos de `app/` e encaminha os pedidos `/api/` para os módulos do servidor. Os dois perfis usam a mesma interface, sem compilação.

```text
app/
  index.html              Interface (PCA e Fábrica)
  style.css               Apresentação, adaptação a diferentes ecrãs e impressão
  app.js                  Painel, formulários, histórico, CSV e impressão
  components/map.js       Mapa interactivo de Moçambique
  components/slideshow.js Sequência e temporização dos slides do Modo TV
  components/dates.js     Regras de calendário e hora de Maputo, sem depender do navegador
  components/calendar.js  Selecção de dias e meses nos formulários
  mocambique.svg          Mapa local, sem dependência da Internet
  logoina.jpg             Identidade visual
backend/
  server.js               Servidor HTTP e controlo de acesso
  setup.js                Configuração inicial das contas
  shared/database.js      Esquema e ligação SQLite
  shared/dates.js         Datas para os módulos do servidor; conversão e ordenação no SQLite
  shared/http.js          Leitura e validação dos pedidos e períodos da API
  modules/auth.js         Credenciais, sessões e permissões
  modules/delegations.js  Catálogo indicativo das delegações
  modules/entries.js      Gravação, correcção, eliminação e auditoria
  modules/dashboard.js    Agregação dos indicadores por período
tests/
  dates.test.cjs          Testes ao calendário e à conversão de datas
  integration.test.cjs    Testes à API, aos perfis e à persistência
  static.test.cjs         Testes aos controlos da interface, ao SVG e às regras do mapa
  slideshow.test.cjs      Testes ao ciclo, aos intervalos e à interrupção da apresentação
package.json              Comandos setup, start, dev e test
.gitignore                Exclui bases de dados, segredos e ficheiros gerados
```

### Correspondência das alterações com a v3

| Alteração desde a base | Onde ficou |
| --- | --- |
| 11 sedes, Maputo e Matola separados e cor por quantidade (`baec809`, `c496ba8`, `f3f8460`, `7984f42`) | `backend/modules/delegations.js` define as sedes e `dashboard.js` fornece as quantidades. Em `app/components/map.js`, a mesma coluna determina o número, a cor da área e a amostra que `app/app.js` mostra na tabela. |
| Contornos, pré-visualização e selecção por clique (`87b494f`, `59f9ea8`, `d432aec`) | `map.js` trata o rato e o teclado, `app.js` mantém a selecção comum ao mapa e à tabela, e `style.css` fixa a caixa de valores à direita. A selecção não filtra os totais. |
| Palavras-passe de 6 a 200 caracteres (`a4e893b`) | `backend/setup.js` recolhe as palavras-passe; `backend/modules/auth.js` aplica a regra aos dois perfis. O PCA continua sem permissão para ler ou alterar registos detalhados. |
| Datas, calendários, CSV e PDF (`42c781f`, `657b147`) | Os campos e os relatórios usam `app/components/dates.js`. No servidor, apenas `backend/shared/dates.js` importa essas regras; a API e o SQLite usam o mesmo `dd/mm/aaaa`, sem duplicar a lógica nem expor o código da base de dados ao navegador. |
| Âmbito do mapa e remoção do importador de lotes (`dbbd716`) | O mapa escolhe as sedes por código, sem apagar delegações de uma base existente. Foram retirados `backend/migrate.js`, `tests/migration.test.cjs` e os comandos `migrate:preview` e `migrate:apply`. A conversão da secção 3 só trata datas da v3. |

### Testar

```bash
npm test
```

## 5. Acesso do PCA a partir de outro computador

Por segurança, `npm start` atende apenas em **127.0.0.1**, ou seja, no próprio computador. O PCA poderá usar outra máquina **após implantação num servidor com rede, HTTPS, autenticação e cópias de segurança**. Nesse caso, o operador responsável pela infra-estrutura deve configurar a aplicação atrás de um *reverse proxy* HTTPS, indicar a interface de rede através de `HOST` e activar `CONTACARTA_SECURE_COOKIE=1`.

Não se recomenda publicar directamente a porta 8000 na Internet ou partilhar ficheiros SQLite numa pasta de rede. As palavras-passe devem ser fortes e diferentes para cada perfil.

O mapa e as coordenadas das delegações são indicativos, sujeitos à confirmação do INATRO, e não constituem cartografia oficial.
