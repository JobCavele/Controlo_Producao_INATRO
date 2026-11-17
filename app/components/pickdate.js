/*
 * Conta Carta · escolher uma data
 *
 * Uma caixa só, que mostra sempre a data como a sala a lê — «16/11/2026»,
 * ou «11/2026» quando o que se escolhe é um mês — e abre o calendário do
 * sistema ao lado. Não há dois controlos para a mesma coisa: o campo é a
 * caixa, e o calendário é a ajuda que ela traz.
 *
 * Como funciona: um <input type="text"> é a cara (escreve-se à mão, em
 * dd/mm/aaaa) e um <input type="date">/("month") invisível, por cima do
 * botão do calendário, é quem abre o calendário. O do sistema mostra sempre
 * aaa-mm-dd por dentro; o valor que sai daqui é o que o core guarda (ISO),
 * e o que se vê é sempre o formato da casa.
 *
 * Cada controlo ocupa o seu <span class="date-pick"> já no index.html; o
 * componente só lhe acrescenta o botão e o calendário. Assim a caixa de
 * texto continua a ser um campo de verdade (etiqueta, foco, teclado) e o
 * mini-DOM dos testes encontra-a como sempre.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaPickDate = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  /** O ícone do calendário: uma folha com um dia marcado, na cor do texto. */
  const CALENDAR_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true" width="17" height="17">'
    + '<rect x="2.6" y="4.2" width="14.8" height="13.2" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/>'
    + '<path d="M2.6 8.4h14.8" stroke="currentColor" stroke-width="1.6"/>'
    + '<path d="M6.6 2.6v3M13.4 2.6v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    + '<circle cx="10" cy="13" r="1.6" fill="currentColor"/></svg>';

  /**
   * Lê o que está escrito e devolve o valor interno (ISO), ou `null` se a
   * pessoa escreveu algo que não é do formato da casa. `kind` é «date» ou
   * «month»; a lista de dias aceita igualmente a forma ISO.
   */
  function read(kind, text) {
    return kind === 'month' ? core.parseMonth(text) : core.parseDate(text);
  }

  /** O que se mostra: dd/mm/aaaa para o dia, mm/aaaa para o mês. */
  function display(kind, iso) {
    if (!iso) return '';
    return kind === 'month' ? core.monthLabel(iso) : core.shortDate(iso);
  }

  /**
   * Liga uma caixa de data. `id` (ou `input`, quando o campo nasce em JS) é a
   * caixa de texto; `value` é o valor interno a mostrar; `onPick` recebe o
   * valor interno novo (ou `''` quando o campo ficou vazio) e devolve `false`
   * se não o aceitou (nesses casos a caixa volta ao que era).
   */
  function attach({ id, input: given, kind = 'date', value = '', onPick, label, el }) {
    const input = given || dom.byId(id);
    if (!input) throw new Error(`A caixa de data «${id}» não existe na página.`);
    const name = label || id || 'a data';
    const native = el('input', {
      type: kind === 'month' ? 'month' : 'date',
      class: 'date-native',
      tabindex: '-1',
      'aria-hidden': 'true',
      'aria-label': `${name} (calendário)`,
      min: kind === 'month' ? '1900-01' : '1900-01-01',
      max: kind === 'month' ? '2200-12' : '2200-12-31',
    });
    const button = el('button', { class: 'date-open', type: 'button', 'aria-label': `Abrir o calendário de ${name}` });
    button.innerHTML = CALENDAR_ICON;
    // a caixa de texto passa a morar dentro do controlo, com o botão ao lado,
    // e no lugar exacto onde estava (as setas ‹ › ficam de fora, à volta)
    const parent = input.parentNode;
    const after = input.nextElementSibling || null;
    const shell = el('span', { class: 'date-pick' }, []);
    input.remove();
    shell.append(input, button, native);
    if (parent) parent.insertBefore(shell, after);

    input.value = display(kind, value);
    native.value = value;

    // a caixa segue o calendário e o calendário segue a caixa: um só valor
    function accept(next) {
      const settled = next === undefined ? '' : next;
      const kept = onPick ? onPick(settled) : true;
      const shown = kept === false ? native.value : settled;
      input.value = display(kind, shown);
      native.value = shown || '';
      return shown;
    }

    /**
     * Abre o calendário do sistema na data que está à vista. Onde o browser
     * não deixa abrir por código, o campo nativo fica à vista e a pessoa
     * toca nele — nunca um botão que não faz nada.
     */
    function openCalendar() {
      const typed = read(kind, input.value);
      if (typed) native.value = typed;
      if (native.showPicker) {
        try { native.showPicker(); return; } catch (_) { /* cai para o campo visível */ }
      }
      const box = input.closest('.date-pick');
      if (box) box.classList.add('is-open');
      if (native.focus) native.focus();
    }

    // o botão faz parte da caixa, não do rótulo que a embrulha: o clique fica dele
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openCalendar(); });
    native.addEventListener('click', (event) => { event.stopPropagation(); openCalendar(); });
    native.addEventListener('change', () => accept(native.value || ''));
    // escrever à mão: ao sair do campo (ou no Enter) o formato da casa arruma-se
    const settle = () => {
      const typed = read(kind, input.value);
      if (typed) accept(typed);
      else if (!input.value.trim()) accept('');
      else input.value = display(kind, native.value);
    };
    input.addEventListener('change', settle);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); settle(); } });

    return {
      /** Põe um valor interno novo sem passar pelo `onPick` (o ecrã mudou por fora). */
      set(next) {
        native.value = next || '';
        input.value = display(kind, next);
      },
      /** O valor interno: vale o que está escrito na caixa; o calendário é o arrumo. */
      value: () => read(kind, input.value) || native.value || '',
      node: shell,
      input,
    };
  }

  return { attach, read, display, CALENDAR_ICON };
});
