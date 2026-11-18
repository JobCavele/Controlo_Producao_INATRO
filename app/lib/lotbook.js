/*
 * Conta Carta · o livro dos lotes e do material
 *
 * As gravações que mexem num lote ou num artigo do armazém passam por aqui,
 * como as de um dia passam pelo livro do dia. E é aqui que se sabe de onde
 * vem cada fase de um lote, porque cada uma tem um lado só:
 *   - um lote que anda pelos movimentos do Painel segue-os (calcula o servidor);
 *   - a impressão e a qualidade de um lote apontado nos dias são as que os
 *     dias dizem — e esse lote não as regista outra vez nos movimentos, nem
 *     um lote com a impressão nos movimentos se aponta nos dias;
 *   - o resto escreve-se no lote.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ContaCartaLotBook = factory(root.ContaCartaCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  /**
   * `app` é o estado da aplicação; `save(next, message, onError)` grava e
   * redesenha; `nextState` monta o estado completo a partir do que muda;
   * `confirm` é o diálogo da casa; `render` redesenha.
   */
  function create({ app, save, nextState, confirm, render }) {
    // os dois formulários entram depois de existirem (mostram os erros e fecham-se quando a gravação fica feita)
    let forms = {};
    const attachForms = (lot, stock) => { forms = { lot, stock }; };
    // o que os movimentos dizem de cada lote: o servidor di-lo sempre que os relê
    let facts = new Map();

    /** O servidor releu os movimentos: guarda, por lote, as fases que eles dizem e se a impressão é deles. */
    function track(batches) {
      facts = new Map((batches || []).map((batch) => [batch.id, batch]));
    }

    /** Esta fase deste lote é a que os movimentos dizem? */
    const driven = (lotId, stage) => ((facts.get(lotId) || {}).driven || []).includes(stage);

    /** Porque é que um lote não se aponta nos dias ('' quando se pode): a impressão dele já se regista nos movimentos. */
    const refusal = (lot) => ((facts.get(lot.id) || {}).byMoves
      ? `O lote ${lot.reference} regista a impressão nos movimentos do Painel: não se aponta outra vez nos dias de produção.` : '');

    /** De onde vem uma fase do lote: 'movimentos', 'dias', ou '' quando se escreve no próprio lote. */
    function source(lot, stage) {
      if (driven(lot.id, stage)) return 'movimentos';
      const pointed = core.DAY_STAGES.includes(stage)
        && app.state.records.some((record) => (record.entries || []).some((entry) => entry.lotId === lot.id));
      return pointed ? 'dias' : '';
    }

    /** Confere o estado seguinte e grava-o; o formulário mostra o erro e só fecha com a gravação feita. */
    async function commit(form, next, message) {
      try {
        core.validate(next);
      } catch (error) {
        form.error(error.message);
        return false;
      }
      if (!(await save(next, message, form.error))) return false;
      form.close();
      return true;
    }

    const without = (list, id) => list.filter((item) => item.id !== id);

    /** Grava o lote lido no formulário; os dias em que foi apontado acompanham-no na mesma gravação. */
    const saveLot = (lot) => commit(forms.lot, nextState({ lots: [...without(app.state.lots, lot.id), lot] }),
      forms.lot.editing() ? 'Lote actualizado.' : 'Lote guardado.');

    /** Grava o material lido no formulário. */
    const saveStock = (item) => commit(forms.stock, nextState({ stock: [...without(app.state.stock, item.id), item] }),
      forms.stock.editing() ? 'Material actualizado.' : 'Material guardado.');

    /** Apaga o lote e, com ele, os seus movimentos; os dias em que foi apontado ficam com o que produziram, sem lote. */
    function deleteLot(lot) {
      const days = app.state.records.filter((record) => (record.entries || []).some((entry) => entry.lotId === lot.id)).length;
      const kept = days ? ` ${days === 1 ? 'O dia em que foi apontado continua' : `Os ${days} dias em que foi apontado continuam`} a contar a produção, já sem lote no quadro.` : '';
      confirm('Eliminar lote?',
        `Vai apagar o lote ${lot.reference} (${core.format(lot.quantity)} cartas) e os seus movimentos.${kept} Exporta uma cópia antes, se precisares de o recuperar.`,
        'Eliminar', () => save(nextState({ lots: without(app.state.lots, lot.id) }), 'Lote eliminado.'));
    }

    /** Apaga o artigo e, com ele, as entradas e saídas do armazém que somaram nele. */
    function deleteStock(item) {
      confirm('Eliminar material?',
        `Vai apagar «${item.name}» do armazém e os seus movimentos. Exporta uma cópia antes, se precisares de o recuperar.`,
        'Eliminar', () => save(nextState({ stock: without(app.state.stock, item.id) }), 'Material eliminado.'));
    }

    /**
     * Um movimento mexeu no que está guardado: o servidor actualizou as fases
     * do lote, ou somou a entrada ou a saída ao artigo, e devolve-o com a
     * revisão nova. Fica tal como veio — ninguém o escreve segunda vez.
     */
    function adopt({ revision, lot, stock }) {
      if (!lot && !stock) return;
      if (revision) app.revision = revision;
      app.state = {
        ...app.state,
        ...(lot ? { lots: [...without(app.state.lots, lot.id), lot] } : {}),
        ...(stock ? { stock: [...without(app.state.stock, stock.id), stock] } : {}),
      };
      render();
    }

    return { attachForms, saveLot, saveStock, deleteLot, deleteStock, track, driven, refusal, source, adopt };
  }

  return { create };
});
