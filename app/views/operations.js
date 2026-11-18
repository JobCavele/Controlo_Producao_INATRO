/*
 * Conta Carta · operações por delegação
 *
 * A parte de baixo do painel, a que só se chega com scroll: o mapa de
 * Moçambique e a lista das delegações (uma por província: o mapa e a lista
 * dizem o mesmo), e os movimentos por quantidades de cada lote (armazém,
 * impressão, qualidade e despacho). Os números são do servidor, que confere o
 * que há disponível antes de guardar; sem servidor esta parte não arranca e
 * fica escondida.
 *
 * O formulário só escolhe: o lote vem do quadro dos lotes e o material da
 * lista do armazém, e nenhum dos dois se reescreve aqui. O que o movimento
 * muda (as fases do lote, o saldo do artigo) é o servidor que actualiza.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaOperations = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const $ = dom.byId;
  const fmt = (value) => core.format(value || 0);

  /** Os movimentos que o servidor aceita, pela ordem do trabalho. */
  const TYPES = {
    stock_in: 'Entrada no armazém', stock_out: 'Saída do armazém', personalized: 'Personalização',
    printed: 'Impressão', print_rejected: 'Rejeição na impressão', qc_approved: 'Aprovação de qualidade',
    qc_rejected: 'Reprovação de qualidade', transfer: 'Movido para despacho', dispatch: 'Despacho',
    batch_error: 'Erro de lote', batch_error_resolved: 'Erro resolvido',
  };
  /**
   * O que cada movimento pede além do lote, da data e da quantidade. Os
   * motivos de uma reprovação são os do core — os mesmos do apontamento do
   * dia —, e um erro de lote tem os seus tipos.
   */
  const ERRORS = [['delegacao-incorrecta', 'Delegação incorrecta'], ['quantidade-incorrecta', 'Quantidade incorrecta'], ['documentacao', 'Documentação incompleta'], ['outro', 'Outro erro']];
  const REASONS = {
    qc_rejected: ['Motivo da reprovação', core.REASONS.map((reason) => [reason.code, reason.label])],
    batch_error: ['Tipo de erro', ERRORS],
  };
  /** Os movimentos do armazém não pertencem a nenhum lote. */
  const STOCK = ['stock_in', 'stock_out'];
  /** O histórico mostra os últimos movimentos, do mais recente para o mais antigo. */
  const HISTORY = 35;

  /** Um pedido ao servidor: devolve o que ele respondeu, ou falha com a frase dele. */
  async function request(url, options) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(answer.error || 'O servidor não respondeu ao pedido.'), { status: response.status });
    return answer;
  }

  /**
   * `ui` traz o desenho (el, fill, options, dateBox, dateText, today); `map`
   * é a peça do mapa; `stock` é a lista do armazém; `onData` recebe os lotes
   * com os seus saldos a cada leitura; `onMove` recebe o que um movimento
   * mudou no que está guardado (a revisão e o lote ou o artigo).
   */
  function create({ ui, map, stock, onData, onMove }) {
    const { el, fill, options, dateBox, dateText, today } = ui;

    let stats = [];         // do servidor: uma linha por delegação, com a província e os números do período
    let active = '';        // a província escolhida no mapa ou na lista ('' quando não há)
    let chart = null;       // o mapa, depois de montado (sem o ficheiro do mapa, o resto funciona na mesma)
    let dates = null;       // as caixas de data: início e fim do período, e o dia do movimento
    let asked = false;      // já se perguntou ao servidor pelos movimentos (sem servidor, nunca se pergunta)
    let lots = [];          // do servidor: os lotes com o que cada fase ainda tem para fazer

    /** A linha de estado por baixo do formulário: o que correu bem, ou porque falhou. */
    function say(text, failed) {
      const line = $('opsMessage');
      line.textContent = text;
      line.classList.toggle('is-error', Boolean(failed));
    }

    /**
     * Uma tabela da casa. Cada coluna é [título, valor da linha, se é número];
     * o valor é um texto ou uma peça já desenhada. `foot` é a linha do total e
     * `mark` dá a classe de cada linha.
     */
    function table(columns, rows, foot, mark) {
      const cell = (tag, numeric, content) => (typeof content === 'object'
        ? el(tag, { class: numeric ? 'is-number' : '' }, [content])
        : el(tag, { class: numeric ? 'is-number' : '', text: content }));
      const line = (row) => el('tr', { class: row === foot ? 'is-total' : (mark ? mark(row) : '') },
        columns.map(([, value, numeric]) => cell('td', numeric, value(row))));
      return el('table', {}, [
        el('thead', {}, [el('tr', {}, columns.map(([title, , numeric]) => cell('th', numeric, title)))]),
        el('tbody', {}, (foot ? [...rows, foot] : rows).map(line)),
      ]);
    }
    const empty = (text) => el('div', { class: 'empty' }, [el('strong', { text })]);
    const count = (key) => (row) => fmt(row[key]);

    /** O que cada movimento pode levar de um lote: o saldo da fase que o recebe. */
    const ROOM = {
      personalized: 'toPersonalize', printed: 'toPrint', qc_approved: 'toQC', qc_rejected: 'toQC',
      transfer: 'toTransfer', dispatch: 'toDispatch', batch_error_resolved: 'unresolvedErrors',
    };

    /**
     * Os lotes para escolher. A impressão e o teste de um lote apontado nos
     * dias de produção registam-se lá, uma vez: aqui esse lote fica à vista
     * mas desligado nesses movimentos, e só se move e se despacha.
     */
    function batches() {
      const told = core.DAY_MOVES.includes($('opsType').value);
      options($('opsBatch'), [['', 'Escolher lote'], ...lots.map((lot) => (told && lot.byDays
        ? [lot.id, `${lot.reference} — ${lot.delegation} (regista-se nos dias de produção)`, true]
        : [lot.id, `${lot.reference} — ${lot.delegation}`]))], $('opsBatch').value);
    }

    /**
     * Cada movimento mostra só os seus campos: o armazém pede o material, a
     * referência e as séries (e não tem lote); a impressão, a máquina; a
     * reprovação e o erro de lote, o seu motivo.
     */
    function showFields() {
      const type = $('opsType').value;
      const warehouse = STOCK.includes(type);
      batches();
      $('opsBatchWrap').hidden = warehouse;
      $('opsReferenceWrap').hidden = !(warehouse || type === 'dispatch');
      $('opsMaterialWrap').hidden = !warehouse;
      $('opsStartWrap').hidden = !warehouse;
      $('opsEndWrap').hidden = !warehouse;
      $('opsMachineWrap').hidden = type !== 'printed';
      const [label, reasons] = REASONS[type] || [];
      $('opsReasonWrap').hidden = !reasons;
      if (reasons) {
        $('opsReasonLabel').textContent = label;
        options($('opsReason'), reasons, $('opsReason').value);
      }
      room();
    }

    /** A caixa da quantidade diz quanto há: o saldo do lote nessa fase, ou o do artigo que sai do armazém. */
    function room() {
      const type = $('opsType').value;
      const lot = lots.find((item) => item.id === $('opsBatch').value);
      const item = stock().find((entry) => entry.id === $('opsMaterial').value);
      const left = type === 'stock_out' ? (item ? core.stockBalance(item) : null) : (lot && ROOM[type] ? lot[ROOM[type]] : null);
      $('opsQuantity').placeholder = left === null ? '' : `até ${fmt(Math.max(0, left))}`;
    }

    /** O material escolhe-se na lista do armazém, com o saldo de cada artigo à vista. */
    function materials() {
      const items = stock().slice().sort((a, b) => a.name.localeCompare(b.name, 'pt'));
      options($('opsMaterial'), [['', items.length ? 'Escolher material' : 'Sem material no armazém'],
        ...items.map((item) => [item.id, `${item.name} — ${fmt(core.stockBalance(item))} ${item.unit}`])], $('opsMaterial').value);
    }

    /** Escolher uma província (no mapa ou na lista) destaca-a nos dois; escolhê-la outra vez tira o destaque. */
    function pick(province) {
      active = province === active ? '' : province;
      draw();
    }

    /** O nome de uma delegação na lista: o tom que a sua província tem no mapa, o nome e a província. */
    function place(row, top) {
      if (row === total) return row.delegation;
      const name = el('span', { class: 'ops-name' }, [
        row.delegation,
        el('small', { text: row.province ? (row.province === row.delegation ? '' : row.province) : 'fora do catálogo' }),
      ]);
      // um nome que não é do catálogo não tem província: lê-se na lista, mas não há onde o pintar
      if (!row.province) return el('span', { class: 'ops-place' }, [el('i', { class: 'ops-tone' }), name]);
      return el('button', {
        class: 'ops-place', type: 'button', 'data-place': row.province, 'aria-pressed': String(row.province === active),
        onclick: () => pick(row.province),
      }, [el('i', { class: 'ops-tone', 'data-level': map.tone(row.produced, top) }), name]);
    }
    let total = null;

    /** O mapa e, ao lado, a lista: as mesmas delegações, os mesmos números. */
    function draw() {
      const placed = stats.filter((row) => row.province);
      const top = Math.max(0, ...placed.map((row) => row.produced));
      if (chart) chart.paint({ rows: new Map(placed.map((row) => [row.province, row])), active });

      const sum = (key) => stats.reduce((result, row) => result + (row[key] || 0), 0);
      total = { delegation: 'Total', produced: sum('produced'), approved: sum('approved'), dispatched: sum('dispatched') };
      const clear = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Limpar escolha', onclick: () => pick(active) });
      clear.hidden = !active;
      // redesenhar a lista não pode tirar o foco a quem anda pelo teclado
      const held = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.place : '';
      fill($('delegationTotals'),
        el('div', { class: 'ops-side-head' }, [el('h3', { text: 'Delegações' }), clear]),
        el('div', { class: 'table-scroll' }, [table([
          ['Delegação', (row) => place(row, top)], ['Produzidas', count('produced'), true],
          ['Aprovadas', count('approved'), true], ['Despachadas', count('dispatched'), true],
        ], stats, total, (row) => (row.province && row.province === active ? 'is-chosen' : ''))]),
        ...(placed.length < stats.length ? [el('p', { class: 'ops-note', text: 'Um nome fora do catálogo não entra no mapa: corrige a delegação no lote ou no registo.' })] : []));
      const again = held && [...$('delegationTotals').querySelectorAll('[data-place]')].find((node) => node.dataset.place === held);
      if (again) again.focus();
    }

    /** Pede ao servidor os números do período e redesenha o mapa, os saldos e o histórico. */
    async function refresh() {
      // um período escrito ao contrário arruma-se sozinho: as duas datas trocam de caixa
      let start = dates.start.value();
      let end = dates.end.value();
      if (start && end && start > end) {
        [start, end] = [end, start];
        dates.start.set(start);
        dates.end.set(end);
      }
      const query = new URLSearchParams();
      if (start) query.set('start', start);
      if (end) query.set('end', end);
      const data = await request(`/api/operations?${query}`);
      stats = data.delegations;
      lots = data.batches;
      onData(lots);
      materials();
      batches();
      room();

      const reference = new Map(data.batches.map((lot) => [lot.id, lot.reference]));
      const material = new Map(stock().map((item) => [item.id, item.name]));
      fill($('opsBalances'), data.batches.length ? table([
        ['Lote', (lot) => lot.reference], ['Delegação', (lot) => lot.delegation],
        ['Por imprimir', count('toPrint'), true], ['Aguardam QC', count('toQC'), true],
        ['Por mover', count('toTransfer'), true], ['Por despachar', count('toDispatch'), true],
        ['Despachadas', count('dispatch'), true], ['Erros', count('unresolvedErrors'), true],
      ], data.batches) : empty('Ainda sem lotes'));
      const latest = data.operations.slice(-HISTORY).reverse();
      fill($('opsHistory'), latest.length ? table([
        ['Data', (move) => dateText(move.date)], ['Operação', (move) => TYPES[move.type] || move.type],
        ['Lote ou material', (move) => reference.get(move.batchId) || material.get(move.metadata.stockId) || move.metadata.material || '—'],
        ['Quantidade', count('quantity'), true],
      ], latest) : empty('Ainda sem movimentos neste período'));
      draw();
    }

    /** Relê os números (o quadro principal gravou, ou o período mudou); se falhar, diz porquê. */
    function sync() {
      return dates ? refresh().catch((error) => say(error.message, true)) : Promise.resolve();
    }

    /**
     * Todos os movimentos guardados, para a cópia de segurança; null quando
     * não há servidor que os guarde. Se o servidor falhar, a cópia não se faz:
     * antes isso do que uma cópia a que faltam os movimentos.
     */
    async function copy() {
      if (!asked) return null;
      try {
        return (await request('/api/operations')).operations;
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    }

    /** Envia o movimento: quem confere as quantidades e recusa o que não bate certo é o servidor. */
    async function submit(event) {
      event.preventDefault();
      const date = dates.day.value();
      if (!date) { say('Escreve a data do movimento em dd/mm/aaaa.', true); return; }
      const movement = {
        type: $('opsType').value, batchId: STOCK.includes($('opsType').value) ? '' : $('opsBatch').value, date, quantity: Number($('opsQuantity').value),
        reference: $('opsReference').value, stockId: $('opsMaterial').value,
        serialStart: $('opsStart').value, serialEnd: $('opsEnd').value,
        machine: $('opsMachine').value, reason: $('opsReason').value,
      };
      try {
        // o servidor responde com o que o movimento mudou no quadro dos lotes ou no armazém: entra no ecrã tal como vem
        onMove(await request('/api/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(movement) }));
      } catch (error) {
        say(error.message, true);
        return;
      }
      $('opsQuantity').value = '';
      say('Movimento registado com sucesso.');
      // o movimento já está guardado: se a releitura falhar, diz-se isso mesmo, para ninguém o repetir
      await refresh().catch(() => say('Movimento registado, mas os números não se actualizaram: recarrega a página.', true));
    }

    /** Vai buscar o desenho do mapa e monta-o. */
    async function mount() {
      const picture = await fetch('mocambique.svg');
      if (!picture.ok) throw new Error('O ficheiro do mapa (mocambique.svg) não foi encontrado');
      chart = map.create($('mozambiqueMap'), await picture.text(), { el, fmt, onPick: pick });
    }

    /**
     * Arranca a secção e mostra-a. Um servidor que não conhece as operações
     * responde 404: não há nada para mostrar e ela fica escondida.
     */
    async function start() {
      asked = true;
      try {
        options($('opsType'), Object.entries(TYPES), $('opsType').value);
        options($('opsMachine'), core.MACHINES.map((name) => [name, name]), $('opsMachine').value);
        materials();
        showFields();
        dates = {
          start: dateBox({ id: 'opsFilterStart', label: 'Início do período' }),
          end: dateBox({ id: 'opsFilterEnd', label: 'Fim do período' }),
          day: dateBox({ id: 'opsDate', label: 'Data do movimento', value: today() }),
        };
        $('opsFilterApply').addEventListener('click', sync);
        $('opsFilterClear').addEventListener('click', () => { dates.start.set(''); dates.end.set(''); sync(); });
        $('opsType').addEventListener('change', showFields);
        $('opsBatch').addEventListener('change', room);
        $('opsMaterial').addEventListener('change', room);
        $('operationForm').addEventListener('submit', submit);
        await mount().catch((error) => fill($('mozambiqueMap'), empty(error.message)));
        await refresh();
        $('panelMore').hidden = false;
      } catch (error) {
        // um servidor sem movimentos: não se volta a perguntar a cada gravação
        if (error.status === 404) { dates = null; return; }
        $('panelMore').hidden = false;
        say(`As operações por delegação não puderam ser carregadas. ${error.message}`, true);
      }
    }

    return { start, sync, copy };
  }

  return { create, TYPES };
});
