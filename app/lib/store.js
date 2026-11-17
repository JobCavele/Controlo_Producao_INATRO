/*
 * Conta Carta · guardar e abrir os dados
 *
 * A única porta para os registos: abrir no arranque e gravar a cada mudança.
 * Com o servidor (SQLite) os dados vivem em `dados/` e a gravação usa a
 * revisão para não passar por cima de outra janela; sem servidor ficam no
 * armazenamento deste navegador. Nenhum registo sai deste computador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./dom.js'));
  else root.ContaCartaStore = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const STORAGE_KEY = 'contacarta-registos-v4';

  /**
   * `app` é o estado da aplicação (com `revision`, `savedAt` e `saving`);
   * `stamp` carimba a hora da gravação; `onError` regista o erro técnico.
   */
  function create({ app, config, stamp, onError, toast, render }) {
    const onServer = config.storage === 'sqlite';
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;

    /** Valida, convertendo primeiro cópias de versões anteriores. */
    function normalise(payload) {
      return core.validate(payload && payload.version === core.VERSION ? payload : core.migrate(payload));
    }

    /** O estado completo: registos, lotes e material. Um só sítio, para nada se perder. */
    function nextState(changes) {
      return {
        version: core.VERSION,
        records: app.state.records,
        lots: app.state.lots,
        stock: app.state.stock,
        sideOpen: app.sideOpen,
        ...changes,
      };
    }

    /** Abre o estado: do servidor SQLite via /api/state ou do navegador (modo offline). */
    async function load() {
      if (onServer) {
        const response = await fetch('/api/state', { cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Não foi possível abrir a base de dados. Confirma que a janela do programa está aberta.');
        return { state: core.validate(body.state), revision: body.revision || 0, savedAt: body.savedAt || null };
      }
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { state: core.emptyState(), revision: 0, savedAt: null };
      return { state: normalise(JSON.parse(stored)), revision: 0, savedAt: null };
    }

    /**
     * Grava o estado com validação e controlo de concorrência. No servidor,
     * uma revisão antiga devolve 409 e a barra de conflito aparece.
     */
    async function persist(next) {
      if (app.saving) return false;
      app.saving = true;
      try {
        core.validate(next);
        if (onServer) {
          const response = await fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revision: app.revision, state: next }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (response.status === 409) $('conflictBar').hidden = false;
            throw new Error(body.error || 'Não foi possível guardar neste computador. Tenta outra vez.');
          }
          app.revision = body.revision;
          app.savedAt = stamp();
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
        app.state = next;
        return true;
      } catch (error) {
        onError(`gravação: ${error.message}`);
        throw error;
      } finally {
        app.saving = false;
      }
    }

    /**
     * Grava, redesenha e avisa. `formError` recebe a mensagem do formulário a
     * que a gravação pertence; sem ele, o erro fica só no aviso curto.
     */
    async function save(next, successMessage, formError) {
      try {
        if (await persist(next)) {
          render();
          if (successMessage) toast(successMessage);
          return true;
        }
      } catch (error) {
        if (formError) formError(error.message);
        toast(error.message);
      }
      return false;
    }

    return { load, persist, save, nextState, normalise, onServer };
  }

  return { create, STORAGE_KEY };
});
