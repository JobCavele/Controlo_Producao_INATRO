/*
 * Conta Carta · cópias de segurança e dados fictícios
 *
 * Exportar e importar a cópia JSON (o estado inteiro: registos, lotes e
 * material) e juntar ou retirar o exemplo que a aplicação traz. Nada daqui
 * sai deste computador: o ficheiro é escrito e lido pelo próprio navegador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaFiles = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const fmt = core.format;
  const SAMPLE_PREFIX = 'exemplo-';

  /**
   * `feedback` dá o aviso, a confirmação e o guarda; `state` lê o estado
   * actual; `save` grava um estado novo; `latest` volta a apontar o filtro
   * para o mês com dados; `ui.today` é o dia de hoje.
   */
  function create({ ui, feedback, state, save, normalise, latest }) {
    const { el, fill, today } = ui;
    const { toast, guard, confirm, download } = feedback;
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;

    const hasSample = () => state().records.some((record) => record.id.startsWith(SAMPLE_PREFIX));

    /** Uma cópia legível (JSON com indentação) de tudo o que está guardado. */
    const exportCopy = guard('exportar cópia', () => {
      download(`contacarta-registos-${core.shortDate(today()).replaceAll('/', '-')}.json`,
        `${JSON.stringify(state(), null, 2)}\n`, 'application/json;charset=utf-8');
      toast('Cópia exportada com os registos deste computador.');
    });

    /** Lê o ficheiro escolhido e, depois da confirmação, substitui os dados. */
    async function importCopy(file, onError) {
      try {
        if (!file) return;
        if (file.size > 5_000_000) throw new Error('A cópia é grande de mais (limite de 5 MB).');
        const text = await file.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch (_) {
          throw new Error('O ficheiro não é JSON válido. Escolhe uma cópia exportada pelo Conta Carta.');
        }
        const next = normalise(payload);
        confirm('Importar cópia?',
          `O ficheiro tem ${fmt(next.records.length)} ${next.records.length === 1 ? 'registo' : 'registos'} e vai substituir os actuais.`,
          'Importar', () => save(next, 'Cópia importada.').then(latest));
      } catch (error) {
        onError(`importação: ${error.message}`);
        toast(error.message);
      } finally {
        $('fileInput').value = '';
      }
    }

    /**
     * Junta o exemplo ao lado dos registos reais (nunca por cima: os dias já
     * ocupados ficam de fora) ou retira-o, quando já lá está.
     */
    const toggleSample = guard('dados fictícios', async () => {
      if (hasSample()) {
        confirm('Remover dados fictícios?', 'Saem só os registos de exemplo; os teus ficam.', 'Remover',
          () => save({
            ...state(),
            records: state().records.filter((record) => !record.id.startsWith(SAMPLE_PREFIX)),
            lots: state().lots.filter((lot) => !lot.id.startsWith(SAMPLE_PREFIX)),
            stock: state().stock.filter((item) => !item.id.startsWith(SAMPLE_PREFIX)),
          }, 'Dados fictícios removidos.').then(latest));
        return;
      }
      const response = await fetch('sample.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível ler o exemplo incluído na aplicação.');
      const sample = core.validate(await response.json());
      // os dias já ocupados pelos teus registos nunca são tocados: o exemplo entra ao lado, menos o que coincide
      const occupied = (record) => state().records.some((own) => record.start <= own.end && own.start <= record.end);
      const fresh = sample.records.filter((record) => !occupied(record));
      const skipped = sample.records.length - fresh.length;
      const skippedNote = skipped ? ` ${fmt(skipped)} coincidem com registos que já tens e ficam de fora.` : '';
      // lotes e material do exemplo entram só se ainda não existir nenhum com a mesma identidade
      const ids = (list) => new Set(list.map((entry) => entry.id));
      const freshLots = sample.lots.filter((lot) => !ids(state().lots).has(lot.id));
      const freshStock = sample.stock.filter((item) => !ids(state().stock).has(item.id));
      if (!fresh.length && !freshLots.length && !freshStock.length) {
        toast('Nada a acrescentar: o exemplo já está todo carregado.');
        return;
      }
      confirm('Ver com dados fictícios?',
        `Vão entrar ${fmt(fresh.length)} registos, ${fmt(freshLots.length)} lotes e ${fmt(freshStock.length)} artigos de material fictícios, ao lado dos teus.${skippedNote}`,
        'Carregar',
        () => save({
          ...state(),
          records: [...state().records, ...fresh],
          lots: [...state().lots, ...freshLots],
          stock: [...state().stock, ...freshStock],
        }, `Exemplo carregado${skipped ? ` (${fmt(fresh.length)} de ${fmt(sample.records.length)})` : ''}. Podes removê-lo quando quiseres.`).then(latest));
    });

    /** Liga os botões das cópias e do exemplo. */
    function wire(onError) {
      $('exportCopy').addEventListener('click', exportCopy);
      $('importCopy').addEventListener('click', () => $('fileInput').click());
      $('fileInput').addEventListener('change', (event) => importCopy(event.target.files[0], onError));
      $('loadSample').addEventListener('click', toggleSample);
    }

    return { wire, hasSample, exportCopy, toggleSample };
  }

  return { create };
});
