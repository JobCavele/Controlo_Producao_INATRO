/* Um selector para todos os campos. O calendário do SO pode trocar dia/mês e usar outro «hoje». */
'use strict';
window.ContaCartaCalendar = function setupCalendarFields({ $, el }) {
  const { validDay, validFilterYear, fromIsoDay, midnight, monthRange, today } = window.ContaCartaDates;
  const dialog = $('calendarDialog'), grid = $('calendarDays'), month = $('calendarMonth'), year = $('calendarYear');
  const months = 'Janeiro Fevereiro Março Abril Maio Junho Julho Agosto Setembro Outubro Novembro Dezembro'.split(' ');
  const two = (n) => String(n).padStart(2, '0');
  month.replaceChildren(...months.map((name, i) => el('option', { value: two(i + 1), text: `${two(i + 1)} · ${name}` })));
  let field;
  const monthValue = () => `${month.value}/${year.value}`;
  function setPeriod(day) { month.value = day.slice(3, 5); year.value = day.slice(6); }
  function draw(preferred = field.value) {
    const period = monthValue(), first = '01/' + period;
    const daily = field.dataset.calendar === 'day', valid = validDay(first);
    $('calendarApply').hidden = daily;
    $('calendarApply').disabled = !valid;
    $('calendarToday').textContent = daily ? 'Hoje' : 'Este mês';
    $('calendarCaption').textContent = !valid ? 'Indique o ano com quatro algarismos (0001 a 9999).'
      : daily ? `Escolha um dia de ${period}.` : `Mês seleccionado: ${period}`;
    grid.hidden = !daily || !valid;
    grid.replaceChildren();
    if (grid.hidden) return;
    const current = today();
    const tabDay = validDay(preferred) && preferred.slice(3) === period ? preferred : current.slice(3) === period ? current : first;
    const weekdays = 'Dom Seg Ter Qua Qui Sex Sáb'.split(' ').map((text) => el('span', { text, 'aria-hidden': 'true' }));
    grid.append(...weekdays);
    const last = Number(monthRange(period).end.slice(0, 2));
    for (let d = 1; d <= last; d++) {
      const day = `${two(d)}/${period}`;
      const button = el('button', { type: 'button', text: two(d), value: day, title: day, 'aria-label': day,
        'aria-pressed': String(day === field.value), tabindex: day === tabDay ? 0 : -1 });
      if (day === current) button.setAttribute('aria-current', 'date');
      if (d === 1) button.style.gridColumnStart = new Date(midnight(first)).getUTCDay() + 1;
      grid.append(button);
    }
  }
  function choose(value) {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    dialog.close();
    field.focus();
  }
  month.addEventListener('change', () => draw());
  year.addEventListener('input', () => draw());
  $('calendarCancel').addEventListener('click', () => dialog.close());
  $('calendarApply').addEventListener('click', () => choose(monthValue()));
  $('calendarToday').addEventListener('click', () => choose(field.dataset.calendar === 'day' ? today() : today().slice(3)));
  grid.addEventListener('click', (event) => { if (event.target.matches('button')) choose(event.target.value); });
  grid.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!step || !event.target.matches('button')) return;
    event.preventDefault();
    const day = fromIsoDay(new Date(midnight(event.target.value) + step * 86400000).toISOString());
    if (!validDay(day)) return;
    setPeriod(day); draw(day);
    grid.querySelector('[tabindex="0"]').focus();
  });

  for (const input of document.querySelectorAll('[data-calendar]')) {
    const kind = input.dataset.calendar;
    const digits = kind === 'day' ? /^(\d{2})(\d{2})(\d{4})$/ : /^(\d{2})(\d{4})$/;
    function validate() {
      const value = input.value;
      if (kind === 'year') input.setCustomValidity(validFilterYear(value) ? '' : 'Indique um ano de 2000 a 2200 (aaaa).');
      else if (kind === 'month') input.setCustomValidity(validDay('01/' + value) ? '' : 'Mês inválido. Use mm/aaaa.');
      else input.setCustomValidity(validDay(value) ? '' : 'Data inválida. Use dd/mm/aaaa.');
    }
    input.addEventListener('input', () => {
      const parts = kind !== 'year' && input.value.match(digits);
      if (parts) input.value = parts.slice(1).join('/');
      validate();
    });
    input.addEventListener('invalid', validate);
    validate();
    if (kind === 'year' || typeof dialog.showModal !== 'function') continue;
    const label = input.labels[0].textContent;
    const title = 'Abrir calendário: ' + label;
    const open = el('button', { type: 'button', class: 'calendar-open', text: '▦', title, 'aria-label': title,
      'aria-haspopup': 'dialog', 'aria-controls': dialog.id });
    open.addEventListener('click', () => {
      field = input;
      const day = kind === 'day' ? field.value : '01/' + field.value;
      setPeriod(validDay(day) ? day : today());
      $('calendarTitle').textContent = 'Calendário · ' + label;
      draw(); dialog.showModal();
      (grid.querySelector('[tabindex="0"]') || month).focus();
    });
    input.classList.add('has-calendar'); input.after(open);
  }
};
