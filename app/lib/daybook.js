/*
 * Conta Carta · o livro do dia
 *
 * Todas as gravações que mexem num dia passam por aqui: apontar um lote,
 * concluir ou reabrir um lote, terminar ou reabrir o dia e eliminar um lote.
 * Cada uma constrói o estado seguinte, valida-o e grava-o pela porta única
 * (`save`) — o painel, os relatórios e as listas lêem o mesmo estado, por
 * isso um lote concluído aparece em todo o sistema sem mais nenhum passo.
 *
 * O quadro dos lotes acompanha sozinho: a impressão e a qualidade de um lote
 * apontado nos dias são as que os dias dizem (a regra é `core.settle`, e
 * corre em todas as gravações). Aqui só se trata do que o dia sabe e mais
 * ninguém: quando um lote deixa de estar apontado em qualquer dia, essas duas
 * fases voltam ao princípio; e quando o formulário do dia corrige o lote, a
 * correcção fica no lote, na mesma gravação.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ContaCartaDayBook = factory(root.ContaCartaCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  /**
   * `app` é o estado da aplicação; `save(next, message, onError)` grava e
   * redesenha; `confirm` é o diálogo da casa; `toast` avisa sem bloquear;
   * `today` diz o dia de hoje; `form` é o formulário do dia (para os erros e
   * para o limpar depois de guardar); `setDay` guarda o dia à vista;
   * `driven(lote, fase)` diz as fases que têm movimentos no servidor.
   */
  function create({ app, save, confirm, toast, today, setDay, redraw, driven }) {
    // o formulário do dia entra depois de existir (mostra os erros e limpa-se depois de guardar)
    let form = { error: () => {}, editing: () => null, again: () => {} };
    const attachForm = (module) => { form = module; };
    /**
     * O dia à vista: o escolhido na lista manda; sem escolha, é o de hoje.
     * Quando alguém abre o dia de hoje a partir da lista, `dayId` guarda-o e
     * a escolha não se perde.
     */
    const day = () => {
      if (app.dayId) {
        const chosen = app.state.records.find((record) => record.id === app.dayId);
        if (chosen) return chosen;
        app.dayId = '';
      }
      return app.state.records.find((record) => record.start === today()) || null;
    };

    /**
     * Os lotes depois de os dias mudarem: o que deixou de estar apontado em
     * qualquer dia perde a impressão e a qualidade que os dias lhe davam
     * (as fases com movimentos não: essas são do servidor).
     */
    function released(records, lots) {
      const pointed = (list) => new Set(list.flatMap((record) => (record.entries || []).map((entry) => entry.lotId)));
      const now = pointed(records);
      const gone = new Set([...pointed(app.state.records)].filter((id) => id && !now.has(id)));
      return gone.size ? lots.map((lot) => (gone.has(lot.id)
        ? core.lotWithStages(lot, core.DAY_STAGES.filter((stage) => !driven(lot.id, stage)).map((stage) => [stage, 0, '']))
        : lot)) : lots;
    }

    /** Grava, validando primeiro; devolve `true` quando o estado ficou gravado. `lots` são os lotes quando esta gravação também os muda. */
    async function commit(records, message, onError, lots = app.state.lots) {
      const next = { ...app.state, version: core.VERSION, records, lots: released(records, lots), sideOpen: app.sideOpen };
      try {
        core.validate(next);
      } catch (error) {
        if (onError) onError(error.message); else toast(error.message);
        return false;
      }
      return save(next, message, onError);
    }

    /** Troca (ou junta) um dia na lista, sem tocar nos outros. */
    const withDay = (record) => [...app.state.records.filter((item) => item.id !== record.id), record];

    /* --------------------------------------------------- o dia --- */

    /**
     * Aponta um lote no dia: cria o dia se ainda não existe, junta a entrada
     * ou substitui a que está a ser corrigida. O diálogo fica aberto e limpo.
     * `fix` é a correcção ao lote do quadro (referência, delegação, cartas)
     * feita com o «Editar» do formulário: fica no próprio lote.
     */
    async function addEntry(entry, date, fix) {
      const existing = app.state.records.find((record) => record.start === date);
      if (existing && existing.closed) {
        form.error(`O dia ${core.shortDate(date)} está terminado. Reabre-o na vista Registos para apontar mais lotes.`);
        return false;
      }
      if (existing && existing.period !== 'day') {
        form.error(`O dia ${core.shortDate(date)} faz parte de um registo de ${existing.period === 'month' ? 'mês' : 'vários dias'}. Edita esse registo na lista dos dias.`);
        return false;
      }
      const wasEditing = Boolean(form.editing());
      const entries = existing ? existing.entries.slice() : [];
      if (entry.lotId && entries.some((item) => item.lotId === entry.lotId && item.id !== entry.id)) {
        form.error(`O lote ${entry.reference} já está apontado no dia ${core.shortDate(date)}: corrige essa linha em vez de o apontar outra vez.`);
        return false;
      }
      const index = entries.findIndex((item) => item.id === entry.id);
      if (index >= 0) entries[index] = entry; else entries.push(entry);
      const record = {
        id: existing ? existing.id : core.generateId(),
        period: 'day', start: date, end: date, entries,
        closed: false, notes: existing ? existing.notes || '' : '',
      };
      // um lote corrigido para outro dia muda de dia: sai de onde estava, e o dia que fica sem lotes desaparece
      const from = app.state.records.find((item) => item.id !== record.id && (item.entries || []).some((old) => old.id === entry.id));
      const others = app.state.records.filter((item) => item.id !== record.id && item !== from);
      const left = from ? from.entries.filter((old) => old.id !== entry.id) : [];
      const records = [...others, ...(left.length ? [{ ...from, entries: left }] : []), record];
      let lots = app.state.lots;
      if (fix) {
        try {
          lots = lots.map((lot) => (lot.id === fix.id ? core.makeLot({ ...lot, ...fix }) : lot));
        } catch (error) {
          form.error(error.message);
          return false;
        }
      }
      const done = from ? `Lote passado para o dia ${core.shortDate(date)}.`
        : wasEditing ? 'Lote actualizado.' : `Lote guardado no dia ${core.shortDate(date)}. Aponta o próximo quando estiver pronto.`;
      const message = `${done}${fix ? ` O lote ${fix.reference} ficou corrigido no quadro e em todos os dias.` : ''}`;
      if (!(await commit(records, message, form.error, lots))) return false;
      setDay(record.id);
      form.again();
      return true;
    }

    /** Conclui (ou reabre) um lote do dia à vista. */
    async function setEntryDone(entryId, done) {
      const record = day();
      if (!record) return false;
      const entries = record.entries.map((entry) => (entry.id === entryId
        ? { ...entry, done, updated: entry.updated || record.start }
        : entry));
      const next = { ...record, entries };
      const message = done
        ? 'Lote concluído. O dia e o resto do sistema já contam com ele.'
        : 'Lote reaberto: ainda não conta como concluído.';
      if (!(await commit(withDay(next), message))) return false;
      setDay(next.id);
      return true;
    }

    /** Termina o dia: com lotes por concluir, pergunta primeiro. */
    async function finishDay() {
      const record = day();
      if (!record) return false;
      const status = core.dayStatus(record);
      const doFinish = () => commit(withDay({ ...record, closed: true }), 'Dia terminado. A conta do dia está fechada.');
      if (!status.open) return doFinish();
      const waiting = `${core.format(status.open)} ${status.open === 1 ? 'lote ainda não está concluído' : 'lotes ainda não estão concluídos'}`;
      return new Promise((resolve) => {
        confirm('Terminar o dia com lotes por concluir?',
          `${core.shortDate(record.start)} tem ${waiting}. Podes terminar agora e concluí-los depois, reabrindo o dia.`,
          'Terminar dia',
          () => { doFinish().then(resolve); });
      });
    }

    /** Reabre um dia terminado, para corrigir ou acrescentar. */
    async function reopenDay() {
      const record = day();
      if (!record) return false;
      return commit(withDay({ ...record, closed: false }), 'Dia reaberto.');
    }

    /** Elimina um lote do dia; o dia que fica sem lotes desaparece da lista. */
    function deleteEntry(entry) {
      const record = day();
      if (!record) return;
      const name = entry.reference || core.MACHINES[entry.machine];
      confirm('Eliminar lote do dia?',
        `Vai apagar «${name}» (${core.format(entry.produced)} cartas produzidas) do dia ${core.shortDate(record.start)}. Exporta uma cópia antes, se precisares de o recuperar.`,
        'Eliminar',
        async () => {
          const entries = record.entries.filter((item) => item.id !== entry.id);
          if (entries.length) {
            await commit(withDay({ ...record, entries }), 'Lote eliminado do dia.');
            return;
          }
          await commit(app.state.records.filter((item) => item.id !== record.id), 'Lote eliminado; o dia ficou sem lotes.');
          setDay('');
        });
    }

    /** Apaga o dia inteiro (todos os seus lotes), com uma pergunta que diz o que se perde. */
    function deleteDay(record) {
      const status = core.dayStatus(record);
      confirm('Eliminar o dia?',
        `Vai apagar o dia ${core.periodLabel(record.start, record.end)} com ${core.format(status.lots)} ${status.lots === 1 ? 'lote' : 'lotes'} e ${core.format(status.totals.produced)} cartas. Exporta uma cópia antes, se precisares de o recuperar.`,
        'Eliminar',
        async () => {
          if (!(await commit(app.state.records.filter((item) => item.id !== record.id), 'Dia eliminado.'))) return;
          if (app.dayId === record.id) setDay('');
        });
    }

    /** Abre um dia na vista (vazio volta ao dia de hoje) e redesenha. */
    function openDay(recordId) {
      setDay(recordId || '');
      redraw();
    }

    return {
      attachForm, day, addEntry, setEntryDone, finishDay, reopenDay, deleteEntry, deleteDay, openDay,
      closeEntry: (id) => setEntryDone(id, true), reopenEntry: (id) => setEntryDone(id, false),
    };
  }

  return { create };
});
