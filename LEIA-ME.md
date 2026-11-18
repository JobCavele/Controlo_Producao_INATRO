# Conta Carta — INATRO, IP

Sistema de consulta e registo manual de quantidades de cartas de condução. A aplicação utiliza **HTML, CSS e JavaScript**, tanto na interface como no servidor. A base de dados é **SQLite**. Não utiliza Python, scripts `.sh`, ficheiros `.bat`, lotes ou armazenamento no navegador.

## 1. Como iniciar

1. Instale o [Node.js](https://nodejs.org/) 22.13 ou superior (recomendado: versão LTS actual).
2. Abra um terminal na pasta deste projecto.
3. Na **primeira utilização**, configure as duas contas:

   ```bash
   npm run setup
   ```

   O programa solicita duas palavras-passe (mínimo de 12 caracteres): uma para **PCA** e outra para **Fábrica**. Guarde-as de forma segura. A configuração não precisa de ser repetida a cada arranque.

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

## 2. Rotina diária da fábrica

1. **Por produzir (INCAPE):** consultar manualmente o número pendente para cada delegação e guardar a quantidade com a data da consulta. É um *instantâneo*: o valor de hoje substitui o de ontem na visão actual; não se somam os vários dias.
2. **Produção:** registar, por data, delegação e máquina 1 ou 2, o número de cartas produzidas e o número rejeitado pela máquina. A rejeição é parte da produção, não uma quantidade adicional.
3. **Controlo de qualidade (QC):** registar as aprovadas e reprovadas por data e delegação; identificar a máquina se essa informação existir, ou escolher **Geral**. Os valores do QC não estão limitados à produção do próprio dia.
4. **Despacho:** registar o número total de cartas enviadas por data e delegação.
5. **Consultar o painel:** escolher o mês, ano ou intervalo de datas. Cada indicador mostra quando o seu grupo de informações foi actualizado.

O painel pode ser impresso ou guardado em PDF através do botão **Imprimir / Guardar PDF**. Os registos detalhados podem ser exportados como CSV no Histórico.

Uma combinação de **data + delegação** (e, na produção/QC, **máquina**) identifica um registo diário. Para corrigir os valores de um registo existente, vá a **Histórico e correcções → Corrigir**. Isso evita duplicar totais por engano. Os despachos do mesmo dia para a mesma delegação devem ser somados manualmente e introduzidos como total diário.

## 3. Base de dados e cópias de segurança

Os registos são guardados na pasta `dados/`, no ficheiro `contacarta.sqlite3`, criado automaticamente. **O navegador não guarda os dados em localStorage.** Todos os números apresentados provêm da base de dados SQLite, através da API.

Tabelas operacionais:

| Tabela | Conteúdo |
| --- | --- |
| `delegations` | Catálogo das delegações e pontos indicativos no mapa. |
| `pending_snapshots` | Quantidades por produzir, por data e delegação. |
| `production_entries` | Produção e rejeições por data, delegação e máquina. |
| `quality_entries` | Aprovadas e reprovadas no QC; máquina 0 = não identificada. |
| `dispatch_entries` | Total diário despachado por delegação. |
| `users`, `sessions` | Credenciais protegidas e sessões temporárias. |
| `audit_log` | Histórico das alterações, com valores anteriores e novos. |

As operações são validadas e executadas em transacções. Cada correcção exige a última revisão do registo, de forma a prevenir sobreposições entre duas pessoas. O SQLite utiliza o modo WAL para melhorar a leitura durante as gravações.

**Cópia de segurança:** pare o servidor e copie o ficheiro `dados/contacarta.sqlite3` para outro local seguro. Se a aplicação estiver em funcionamento, faça uma cópia de segurança SQLite consistente; não copie isoladamente o ficheiro principal enquanto existirem ficheiros WAL.

### Dados de versões anteriores

Se for utilizada uma base antiga, as tabelas `app_state` e `operations` **são preservadas**. Os valores anteriores não são automaticamente somados aos novos, porque alguns representam a mesma produção em modelos diferentes. Consulte primeiro:

```bash
npm run migrate:preview
```

Se a pré-visualização não apresentar conflitos e os totais corresponderem aos registos em papel, pode importar as parcelas compatíveis:

```bash
npm run migrate:apply
```

A importação cria uma cópia SQLite de segurança antes de escrever e mantém os registos antigos intactos. Alguns registos, nomeadamente rejeições antigas sem identificação da máquina e QC sem aprovação explícita, necessitam de reconciliação manual. **Não execute a importação enquanto existirem dúvidas sobre os totais históricos.**

Se os registos de uma versão antiga existiam **apenas no armazenamento de um navegador**, não aparecem por si na nova base. Esses dados terão de ser exportados do navegador antigo e reconciliados para introdução no novo sistema.

## 4. Organização do projecto

```text
app/
  index.html              Interface (PCA e Fábrica)
  style.css               Apresentação e adaptação a diferentes ecrãs
  app.js                  Leitura, formulários, painel, histórico e exportação
  components/map.js       Mapa interactivo de Moçambique
  mocambique.svg          Mapa local, sem dependência da Internet
  logoina.jpg             Identidade visual
backend/
  server.js               Servidor HTTP e controlo de acesso
  setup.js                Configuração inicial das contas
  migrate.js              Migração voluntária de dados antigos
  shared/database.js      Esquema e ligação SQLite
  shared/http.js          Validação de pedidos e datas
  modules/auth.js         Credenciais, sessões e permissões
  modules/delegations.js  Catálogo indicativo das delegações
  modules/entries.js      Gravação, correcção, eliminação e auditoria
  modules/dashboard.js    Agregação dos indicadores por período
tests/
  integration.test.cjs    Testes à API, aos perfis e à persistência
```

### Testar

```bash
npm test
```

## 5. Acesso do PCA a partir de outro computador

Por segurança, `npm start` atende apenas em **127.0.0.1**, ou seja, no próprio computador. O PCA poderá usar outra máquina **após implantação num servidor com rede, HTTPS, autenticação e cópias de segurança**. Nesse caso, o operador responsável pela infra-estrutura deve configurar a aplicação atrás de um *reverse proxy* HTTPS, indicar a interface de rede através de `HOST` e activar `CONTACARTA_SECURE_COOKIE=1`.

Não se recomenda publicar directamente a porta 8000 na Internet ou partilhar ficheiros SQLite numa pasta de rede. As palavras-passe devem ser fortes e diferentes para cada perfil.

O mapa e as coordenadas das delegações são indicativos, sujeitos à confirmação do INATRO, e não constituem cartografia oficial.
