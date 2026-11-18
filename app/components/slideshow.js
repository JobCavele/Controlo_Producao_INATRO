/* Relógio da apresentação: resumo nacional, máquinas e sedes na ordem do mapa. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaSlideshow = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FADE_MS = 260;
  const duration = (seconds) => seconds === 15 || seconds === 0 ? seconds : 5;

  function create({ render, fade }) {
    let rows = [], code = '', phase = 'summary', active = false, visible = true, seconds = 5, timer;
    const index = () => rows.findIndex((row) => row.code === code);
    function draw() {
      const i = index();
      render(phase === 'delegation' ? rows[i] : null, phase === 'delegation' ? i + 1 : 0, rows.length, phase);
    }
    function next() {
      if (phase === 'summary') phase = 'machines';
      else {
        code = rows[phase === 'machines' ? 0 : index() + 1]?.code ?? '';
        phase = code ? 'delegation' : 'summary';
      }
    }
    function schedule() {
      clearTimeout(timer);
      fade(false);
      if (!active || !visible || !seconds) return;
      // O fade de saída faz parte dos 5/15 s, não aumenta a duração do slide.
      timer = setTimeout(() => {
        fade(true);
        timer = setTimeout(() => {
          next();
          draw();
          schedule();
        }, FADE_MS);
      }, seconds * 1000 - FADE_MS);
    }
    return {
      start(pace) { active = true; seconds = duration(pace); phase = 'summary'; code = ''; draw(); schedule(); },
      stop() { active = false; phase = 'summary'; code = ''; schedule(); draw(); },
      setSeconds(pace) { seconds = duration(pace); schedule(); },
      setVisible(on) { visible = on; schedule(); },
      setRows(next) {
        rows = next;
        if (!active) return;
        // A sincronização actualiza os valores, mas não reinicia a passagem pela mesma sede.
        const lost = phase === 'delegation' && index() < 0;
        if (lost) { phase = 'summary'; code = ''; }
        draw();
        if (lost) schedule();
      },
    };
  }
  return { create, FADE_MS };
});
