/*
 * Conta Carta · filtro do período (mês, ano e intervalo)
 *
 * As setas que correm um mês ou um ano de cada vez. A escolha em si é uma
 * caixa de data (components/pickdate.js), igual em toda a aplicação; aqui
 * fica só a aritmética do passo, para o app.js continuar pequeno.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ContaCartaPeriod = factory(root.ContaCartaCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  /**
   * O filtro depois de uma seta: um mês ou um ano à frente (ou atrás). Quando
   * o filtro ainda não tem período, parte do mês em que se está.
   */
  function stepPeriod(filter, offset, today) {
    const now = core.parseDate(today || '') ? today : new Date().toISOString().slice(0, 10);
    const base = filter.month || now.slice(0, 7);
    if (filter.mode === 'year') {
      const year = Math.min(2200, Math.max(1900, (Number(filter.year) || Number(base.slice(0, 4))) + offset));
      return { year: String(year), month: `${year}-01` };
    }
    return { month: core.shiftMonth(base, offset) };
  }

  return { stepPeriod };
});
