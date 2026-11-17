/*
 * Conta Carta · o livro do dia
 *
 * Todas as gravações que mexem num dia passam por aqui: apontar um lote,
 * concluir ou reabrir um lote, terminar ou reabrir o dia e eliminar um lote.
 * Cada uma constrói o estado seguinte, valida-o e grava-o pela porta única
 * (`save`) — o painel, os relatórios e as listas lêem o mesmo estado, por
 * isso um lote concluído aparece em todo o sistema sem mais nenhum passo.
 *
 * O quadro dos lotes preparados é apoio: quando um lote do quadro é apontado,
 * a fase de impressão fica feita; quando é concluído, a fase da qualidade
 * também. Se o quadro recusar a actualização, o dia grava-se à mesma.
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
   * para o limpar depois de guardar); `setDay` guarda o dia à vista.
   */
  function create({ app, save, confirm, toast, today, setDay, redraw }) {
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

    /** Grava, validando primeiro; devolve `true` quando o estado ficou gravado. */
    async function commit(records, message, onError) {
      const next = { ...app.state, version: core.VERSION, records, sideOpen: app.sideOpen };
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
     */
    async function addEntry(entry, date) {
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
      const index = entries.findIndex((item) => item.id === entry.id);
      if (index >= 0) entries[index] = entry; else entries.push(entry);
      const record = {
        id: existing ? existing.id : core.generateId(),
        period: 'day', start: date, end: date, entries,
        closed: false, notes: existing ? existing.notes || '' : '',
      };
      const message = wasEditing ? 'Lote actualizado.'
        : `Lote guardado no dia ${core.shortDate(date)}. Aponta o próximo quando estiver pronto.`;
      if (!(await commit(withDay(record), message, form.error))) return false;
      setDay(record.id);
      form.again();
      await markStage(entry, 'impressao', entry.updated || date);
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
      if (done) await markStage(entries.find((entry) => entry.id === entryId), 'qualidade', record.start);
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

    /* ---------------------------------------- o quadro dos lotes --- */

    /**
     * Uma fase do lote preparado fica feita quando o dia o confirma. Nunca
     * trava o dia: o quadro é apoio à produção, não a produção.
     */
    async function markStage(entry, stage, date) {
      if (!entry || !entry.lotId) return;
      const lot = app.state.lots.find((item) => item.id === entry.lotId);
      if (!lot || lot.stages[stage].state === 'feito') return;
      const stages = { ...lot.stages, [stage]: { ...lot.stages[stage], state: 'feito', updated: date } };
      const next = { ...app.state, version: core.VERSION, lots: [...app.state.lots.filter((item) => item.id !== lot.id), { ...lot, stages }], sideOpen: app.sideOpen };
      try {
        core.validate(next);
      } catch (_) {
        return; // o quadro recusou: o dia já está gravado, e é isso que conta
      }
      await save(next, null);
    }

    return {
      attachForm, day, addEntry, setEntryDone, finishDay, reopenDay, deleteEntry, deleteDay, openDay,
      closeEntry: (id) => setEntryDone(id, true), reopenEntry: (id) => setEntryDone(id, false),
    };
  }

  return { create };
});
