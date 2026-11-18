/*
 * Conta Carta · delegações
 *
 * O catálogo das delegações do INATRO: uma por província e a da Cidade de
 * Maputo (na província de Maputo, a delegação é a da Matola). É a mesma lista
 * para o servidor e para o ecrã: os formulários escolhem daqui, e o mapa pinta
 * cada província pelo que a sua delegação produziu.
 *
 * Um nome escrito de outra maneira num registo antigo («Delegação da Beira»,
 * «Nacala») não se perde: `find` diz a que delegação pertence.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaDelegations = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** O código, o nome que se escolhe nos formulários e a província de cada delegação. */
  const LIST = [
    { code: 'BEI', name: 'Beira', province: 'Sofala' },
    { code: 'CHI-S', name: 'Chimoio', province: 'Manica' },
    { code: 'INH', name: 'Inhambane', province: 'Inhambane' },
    { code: 'LIC', name: 'Lichinga', province: 'Niassa' },
    { code: 'MAP-C', name: 'Maputo Cidade', province: 'Maputo Cidade' },
    { code: 'MAT', name: 'Matola', province: 'Maputo' },
    { code: 'NAM', name: 'Nampula', province: 'Nampula' },
    { code: 'PEM', name: 'Pemba', province: 'Cabo Delgado' },
    { code: 'QUE', name: 'Quelimane', province: 'Zambézia' },
    { code: 'TET', name: 'Tete', province: 'Tete' },
    { code: 'XAI', name: 'Xai-Xai', province: 'Gaza' },
  ];

  /**
   * Outros nomes por que uma delegação já foi escrita. Os lugares que estiveram
   * no catálogo como delegações contam para a da sua província. «Maputo»
   * sozinho é a cidade: a província diz-se «Maputo Província» ou «Matola».
   */
  const OTHER_NAMES = {
    Maputo: 'Maputo Cidade', 'Cidade de Maputo': 'Maputo Cidade',
    'Maputo Província': 'Matola', 'Província de Maputo': 'Matola', Boane: 'Matola', Manhiça: 'Matola',
    Chibuto: 'Xai-Xai', Bilene: 'Xai-Xai', Maxixe: 'Inhambane', Vilankulo: 'Inhambane',
    Dondo: 'Beira', Manica: 'Chimoio', Moatize: 'Tete', Mocuba: 'Quelimane', Gurúè: 'Quelimane',
    Nacala: 'Nampula', Angoche: 'Nampula', Cuamba: 'Lichinga', Montepuez: 'Pemba',
  };

  /** Um nome em minúsculas, sem acentos nem pontuação: é assim que se comparam. */
  const plain = (name) => String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();

  const byName = new Map(LIST.map((entry) => [entry.name, entry]));
  const byProvince = new Map(LIST.map((entry) => [plain(entry.province), entry]));
  const known = new Map();
  for (const entry of LIST) known.set(plain(entry.name), entry);
  for (const [name, target] of Object.entries(OTHER_NAMES)) known.set(plain(name), byName.get(target));
  // o nome da província também serve («Sofala» é a delegação da Beira); «Maputo» já ficou decidido acima
  for (const [province, entry] of byProvince) if (!known.has(province)) known.set(province, entry);

  /** A delegação do catálogo a que um nome pertence, ou null quando não se reconhece. */
  function find(name) {
    const text = plain(name);
    const rest = text.replace(/^delegacao( provincial)?( d[aeo]s?)?( |$)/, '');
    if (!rest) return null;
    // uma «Delegação Provincial de Maputo» é a da província, não a da cidade
    if (text.startsWith('delegacao provincial') && byProvince.has(rest)) return byProvince.get(rest);
    // «Província de Sofala» e «Cidade da Beira» dizem o mesmo que «Sofala» e «Beira»
    return known.get(rest) || known.get(rest.replace(/^(provincia|cidade) (d[aeo] )?/, '').replace(/ (provincia|cidade)$/, '')) || null;
  }

  /** O texto de uma delegação numa lista: a província vai entre parênteses quando o nome não a diz. */
  const label = (entry) => (entry.name === entry.province ? entry.name : `${entry.name} (${entry.province})`);

  /**
   * As escolhas de uma lista de delegações, em pares [valor, texto]. Um nome
   * que já estava gravado e não é do catálogo fica na lista: abrir e guardar
   * um registo antigo não lhe tira a delegação.
   */
  function choices(current) {
    const kept = current && !byName.has(current) ? [[current, `${current} (registo anterior)`]] : [];
    return [['', 'Escolher delegação'], ...LIST.map((entry) => [entry.name, label(entry)]), ...kept];
  }

  return { LIST, find, label, choices };
});
