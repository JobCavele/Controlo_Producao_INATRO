/* Calendário partilhado pelo navegador e pelo servidor. O formato público é dd/mm/aaaa. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaDates = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // A chave ano-mês-dia é só para comparar ou calcular; nunca se interpreta «03/04» com Date.parse.
  const orderKey = (value) => `${value.slice(6, 10)}-${value.slice(3, 5)}-${value.slice(0, 2)}${value.slice(10)}`;
  const fromIsoDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const midnight = (value) => Date.parse(orderKey(value) + 'T00:00:00Z');
  function validDay(value) {
    if (typeof value !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(value) || value.endsWith('/0000')) return false;
    const ms = midnight(value);
    return Number.isFinite(ms) && fromIsoDay(new Date(ms).toISOString()) === value;
  }

  // Instantes em hora de Maputo (UTC+02:00), com os milissegundos originais para auditoria e sessões.
  function timestamp(ms = Date.now()) {
    const local = new Date(ms + 2 * 3600_000).toISOString();
    return `${fromIsoDay(local)} ${local.slice(11, 23)}`;
  }
  const instant = (value) => Date.parse(orderKey(value).replace(' ', 'T') + '+02:00');
  const today = () => timestamp().slice(0, 10);
  const firstOfMonth = (value) => '01/' + value.slice(3);
  const validFilterYear = (value) => typeof value === 'string' && /^\d{4}$/.test(value) && Number(value) >= 2000 && Number(value) <= 2200;
  function monthRange(month) {
    const start = '01/' + month;
    if (!validDay(start)) throw new Error('Mês inválido. Use mm/aaaa.');
    const last = new Date(midnight(start));
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    return { start, end: fromIsoDay(last.toISOString()) };
  }

  return { orderKey, fromIsoDay, midnight, validDay, validFilterYear, timestamp, instant, today, firstOfMonth, monthRange };
});
