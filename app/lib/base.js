/*
 * Conta Carta · base dos módulos
 *
 * Os módulos da interface recebem todos as peças de que precisam num objeto
 * só (estado, desenho, gravação) e devolvem a sua API. Esta fábrica faz a
 * única coisa que se repetia em cada ligação: conferir que não falta nada e
 * dizer, alto e cedo, qual peça ficou por ligar.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaModule = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Liga um módulo. `deps` é o que ele precisa; `build` recebe-o já conferido
   * e devolve a API do módulo. Falhar aqui é erro de programação e aparece
   * no arranque, com o nome do módulo e a peça em falta — nunca a meio de um
   * clique.
   */
  function create(name, deps, build) {
    const missing = Object.keys(deps).filter((key) => deps[key] === undefined || deps[key] === null);
    if (missing.length) throw new Error(`O módulo «${name}» ficou sem ${missing.join(', ')}.`);
    return build(deps);
  }

  return { create };
});
