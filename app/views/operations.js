/*
 * Conta Carta · operações por delegação
 *
 * A parte de baixo do painel, a que só se chega com scroll: o mapa de
 * Moçambique com o que cada província e cada delegação produziu, e os
 * movimentos por quantidades de cada lote (armazém, impressão, qualidade e
 * despacho). Os números são do servidor, que confere o que há disponível
 * antes de guardar; sem servidor esta parte não arranca e fica escondida.
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
  /** Os motivos de reprovação do INCAPE e os tipos de erro de um lote. */
  const REASONS = {
    'bio-foto': 'INCAPE — foto ou assinatura', 'bio-outra': 'INCAPE — dados biográficos',
    'scan-foto': 'INCAPE — qualidade da fotografia', 'material-lamina': 'INCAPE — laminado defeituoso',
    'material-riscos': 'INCAPE — riscos', 'cartao-reutilizado': 'INCAPE — cartão reutilizado',
    outro: 'Outro (a validar com INCAPE)', 'delegacao-incorrecta': 'Delegação incorrecta',
    'quantidade-incorrecta': 'Quantidade incorrecta', documentacao: 'Documentação incompleta',
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

  /** `ui` traz o desenho (el, fill, dateBox, dateText, today); `map` é a peça do mapa. */
  function create({ ui, map }) {
    const { el, fill, dateBox, dateText, today } = ui;

    let delegations = [];   // do servidor: nome, província e coordenadas de cada delegação
    let stats = [];         // produzidas, aprovadas e despachadas por delegação, no período
    let active = {};        // o que está escolhido no mapa: { province } ou { point }
    let chart = null;       // o mapa, depois de montado (sem o ficheiro do mapa, o resto funciona na mesma)
    let dates = null;       // as caixas de data: início e fim do período, e o dia do movimento

    /** A linha de estado por baixo do formulário: o que correu bem, ou porque falhou. */
    function say(text, failed) {
      const line = $('opsMessage');
      line.textContent = text;
      line.classList.toggle('is-error', Boolean(failed));
    }

    /** Uma tabela da casa. Cada coluna é [título, valor da linha, se é número]; `foot` é a linha do total. */
    function table(columns, rows, foot) {
      const cell = (tag, numeric, text) => el(tag, { class: numeric ? 'is-number' : '', text });
      const line = (row) => el('tr', { class: row === foot ? 'is-total' : '' },
        columns.map(([, value, numeric]) => cell('td', numeric, value(row))));
      return el('table', {}, [
        el('thead', {}, [el('tr', {}, columns.map(([title, , numeric]) => cell('th', numeric, title)))]),
        el('tbody', {}, (foot ? [...rows, foot] : rows).map(line)),
      ]);
    }
    const empty = (text) => el('div', { class: 'empty' }, [el('strong', { text })]);
    const count = (key) => (row) => fmt(row[key]);

    /** Enche uma lista de escolha sem perder o que lá estava escolhido. */
    function options(select, pairs) {
      const kept = select.value;
      fill(select, ...pairs.map(([value, text]) => el('option', { value, text })));
      select.value = pairs.some(([value]) => value === kept) ? kept : pairs[0][0];
    }

    /** Cada movimento pede os seus campos: o armazém, a referência e as séries; a impressão, a máquina. */
    function showFields() {
      const type = $('opsType').value;
      const stock = STOCK.includes(type);
      $('opsReferenceWrap').hidden = !(stock || type === 'dispatch');
      $('opsMaterialWrap').hidden = !stock;
      $('opsStartWrap').hidden = !stock;
      $('opsEndWrap').hidden = !stock;
      $('opsMachineWrap').hidden = type !== 'printed';
      $('opsReasonWrap').hidden = !(type === 'qc_rejected' || type === 'batch_error');
      $('opsBatch').disabled = stock;
    }

    /** Escolher o que já está escolhido (ou «Ver todas») volta a mostrar o país inteiro. */
    function pick(choice) {
      const same = (choice.point && choice.point === active.point) || (choice.province && choice.province === active.province);
      active = same ? {} : choice;
      draw();
    }

    /** O mapa e, ao lado, as quantidades do que está escolhido: uma delegação, uma província ou todas. */
    function draw() {
      const numbers = new Map(stats.map((row) => [row.delegation, row]));
      // cada delegação da lista oficial com os seus números (zero quando ainda não tem movimento)
      const places = delegations.map((delegation) => ({ ...delegation, delegation: delegation.name, produced: 0, approved: 0, dispatched: 0, ...numbers.get(delegation.name) }));
      const totals = new Map();
      for (const place of places) totals.set(place.province, (totals.get(place.province) || 0) + place.produced);
      if (chart) chart.paint({ totals, active, delegations: places });

      // escolhida uma província ou um ponto, vêem-se as suas delegações (mesmo a zero); sem escolha, as que têm movimento
      const rows = active.point || active.province
        ? places.filter((place) => (active.point ? place.name === active.point : place.province === active.province)).sort((a, b) => b.produced - a.produced)
        : stats.filter((row) => row.produced || row.approved || row.dispatched);
      const sum = (key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
      const foot = rows.length > 1 ? { delegation: 'Total', produced: sum('produced'), approved: sum('approved'), dispatched: sum('dispatched') } : null;
      const all = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Ver todas', onclick: () => pick({}) });
      all.hidden = !(active.point || active.province);
      const title = active.point || (active.province ? map.provinceLabel(active.province) : 'Delegações com movimento');
      fill($('delegationTotals'),
        el('div', { class: 'ops-side-head' }, [el('h3', { text: title }), all]),
        rows.length ? el('div', { class: 'table-scroll' }, [table([
          ['Delegação', (row) => row.delegation], ['Produzidas', count('produced'), true],
          ['Aprovadas', count('approved'), true], ['Despachadas', count('dispatched'), true],
        ], rows, foot)]) : empty('Sem movimentos neste período'));
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

      const reference = new Map(data.batches.map((lot) => [lot.id, lot.reference]));
      options($('opsBatch'), [['', 'Escolher lote'], ...data.batches.map((lot) => [lot.id, `${lot.reference} — ${lot.delegation}`])]);
      fill($('opsBalances'), data.batches.length ? table([
        ['Lote', (lot) => lot.reference], ['Delegação', (lot) => lot.delegation],
        ['Por imprimir', count('toPrint'), true], ['Aguardam QC', count('toQC'), true],
        ['Por mover', count('toTransfer'), true], ['Por despachar', count('toDispatch'), true],
        ['Despachadas', count('dispatch'), true], ['Erros', count('unresolvedErrors'), true],
      ], data.batches) : empty('Ainda sem lotes'));
      const latest = data.operations.slice(-HISTORY).reverse();
      fill($('opsHistory'), latest.length ? table([
        ['Data', (move) => dateText(move.date)], ['Operação', (move) => TYPES[move.type] || move.type],
        ['Lote', (move) => reference.get(move.batchId) || (move.metadata && move.metadata.material) || '—'],
        ['Quantidade', count('quantity'), true],
      ], latest) : empty('Ainda sem movimentos neste período'));
      draw();
    }

    /** Relê os números (o quadro principal gravou, ou o período mudou); se falhar, diz porquê. */
    function sync() {
      return dates ? refresh().catch((error) => say(error.message, true)) : Promise.resolve();
    }

    /** Envia o movimento: quem confere as quantidades e recusa o que não bate certo é o servidor. */
    async function submit(event) {
      event.preventDefault();
      const date = dates.day.value();
      if (!date) { say('Escreve a data do movimento em dd/mm/aaaa.', true); return; }
      const movement = {
        type: $('opsType').value, batchId: $('opsBatch').value, date, quantity: Number($('opsQuantity').value),
        reference: $('opsReference').value, material: $('opsMaterial').value,
        serialStart: $('opsStart').value, serialEnd: $('opsEnd').value,
        machine: $('opsMachine').value, reason: $('opsReason').value,
      };
      try {
        await request('/api/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(movement) });
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
      try {
        delegations = await request('/api/delegations');
        // as listas de delegação dos formulários do lote e do dia vêm daqui; um nome antigo não se perde
        for (const id of ['lotDelegation', 'entryDelegation']) {
          const kept = $(id).value;
          const old = kept && !delegations.some((delegation) => delegation.name === kept) ? [[kept, `${kept} (registo anterior)`]] : [];
          options($(id), [['', 'Escolher delegação'], ...delegations.map(({ name, province }) => [name, `${name} (${province})`]), ...old]);
        }
        options($('opsType'), Object.entries(TYPES));
        options($('opsReason'), Object.entries(REASONS));
        showFields();
        dates = {
          start: dateBox({ id: 'opsFilterStart', label: 'Início do período' }),
          end: dateBox({ id: 'opsFilterEnd', label: 'Fim do período' }),
          day: dateBox({ id: 'opsDate', label: 'Data do movimento', value: today() }),
        };
        $('opsFilterApply').addEventListener('click', sync);
        $('opsFilterClear').addEventListener('click', () => { dates.start.set(''); dates.end.set(''); sync(); });
        $('opsType').addEventListener('change', showFields);
        $('operationForm').addEventListener('submit', submit);

        await mount().catch((error) => fill($('mozambiqueMap'), empty(error.message)));
        $('panelMore').hidden = false;
        await refresh();
      } catch (error) {
        if (error.status === 404) return;
        $('panelMore').hidden = false;
        say(`As operações por delegação não puderam ser carregadas. ${error.message}`, true);
      }
    }

    return { start, sync };
  }

  return { create, TYPES, REASONS };
});
