/* Relógio da apresentação: resumo nacional, depois as sedes na ordem do mapa. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaSlideshow = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FADE_MS = 260;
  const duration = (seconds) => seconds === 15 || seconds === 0 ? seconds : 5;

  function create({ render, fade }) {
    let rows = [], code = '', active = false, visible = true, seconds = 5, timer;
    const index = () => rows.findIndex((row) => row.code === code);
    function draw() {
      const i = index();
      render(rows[i] ?? null, i + 1, rows.length); // null: os seis cartões, sem delegação seleccionada na TV
    }
    function schedule() {
      clearTimeout(timer);
      fade(false);
      if (!active || !visible || !seconds || !rows.length) return;
      // O fade de saída faz parte dos 5/15 s, não aumenta a duração do slide.
      timer = setTimeout(() => {
        fade(true);
        timer = setTimeout(() => {
          code = rows[index() + 1]?.code ?? '';
          draw();
          schedule();
        }, FADE_MS);
      }, seconds * 1000 - FADE_MS);
    }
    return {
      start(pace) { active = true; seconds = duration(pace); code = ''; draw(); schedule(); },
      stop() { active = false; code = ''; schedule(); draw(); },
      setSeconds(pace) { seconds = duration(pace); schedule(); },
      setVisible(on) { visible = on; schedule(); },
      setRows(next) {
        const hadRows = rows.length > 0;
        rows = next;
        if (!active) return;
        // A sincronização actualiza os valores, mas não reinicia a passagem pela mesma sede.
        const lost = code !== '' && index() < 0;
        if (lost) code = '';
        draw();
        if (lost || hadRows !== (rows.length > 0)) schedule();
      },
    };
  }
  return { create, FADE_MS };
});
