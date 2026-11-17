/*
 * Verificações estáticas à aplicação servida (sem navegador).
 * Apanham o que os testes funcionais não vêem: ficheiros órfãos, restos de
 * versões antigas, cores fora da marca, texto de ajuda no ecrã e acessos à rede.
 *
 *   node tests/test-static.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, "app");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const html = read('app/index.html');
const css = read('app/style.css');
const app = read('app/app.js');
const core = read('app/lib/core.js');
const pdf = read('app/lib/pdf.js');
const period = read('app/lib/period.js');
const side = read('app/lib/side.js');
const base = read('app/lib/base.js');
const table = read('app/components/table.js');
const ui = read('app/components/ui.js');
const chips = read('app/components/chips.js');
const forms = read('app/components/form.js');
const reports = read('app/views/reports.js');
const panel = read('app/views/panel.js');
const zoom = read('app/components/zoom.js');
/* 1 · tudo o que a página carrega existe, e nada fica para trás */
const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((src) => !src.startsWith('http'));
// a pasta publicada tem subpastas: lib/ (regras e dados), components/, views/
const published = [];
(function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), name);
    else published.push(name);
  }
})(DIST);
referenced.forEach((src) => assert.ok(published.includes(src), `${src} é carregado pela página mas não existe`));
// todos os módulos publicados, sem lista à mão: um ficheiro novo entra sozinho na verificação
const scripts = Object.fromEntries(published.filter((file) => file.endsWith('.js'))
  .map((file) => [file, read(`app/${file}`)]));
// lidos pelo código em tempo de execução (logótipo do PDF, exemplo, dados de arranque)
const readAtRuntime = ['inatro-letterhead.jpg', 'inatro.png', 'sample.json', 'seed.json', 'index.html'];
const stray = published.filter((file) => !referenced.includes(file) && !readAtRuntime.includes(file));
assert.deepEqual(stray, [], 'a pasta publicada só contém o que a aplicação usa');
const folders = fs.readdirSync(DIST, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert.deepEqual(folders, ['components', 'lib', 'views'], 'a aplicação vive em lib/, components/ e views/');
assert.ok(fs.existsSync(path.join(DIST, 'app.js')), 'app.js fica na raiz de app/');
// o tecto de cada módulo: o núcleo dos dados e o PDF são grandes por natureza,
// as vistas e os componentes têm de caber num ecrã de código
const CORE_FILES = ['lib/core.js', 'lib/pdf.js'];
Object.keys(scripts).forEach((file) => {
  const limit = CORE_FILES.includes(file) ? 90_000 : 20_000;
  assert.ok(scripts[file].length < limit, `${file} está grande de mais (parte-o em módulos)`);
});
const files = { length: published.length };
assert.ok(!fs.readdirSync(DIST).some((name) => name.endsWith('.js') && name !== 'app.js' && name !== 'config.js'),
  'só app.js e config.js ficam na raiz: o resto vive nas pastas');
console.log(`· ${files.length} ficheiros em app/, todos usados, nenhum a mais`);

/* 2 · o repositório não leva dados, bases de dados nem ficheiros de trabalho */
try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  const junk = tracked.filter((file) => /(^|\/)(dados|node_modules|image-search|tmp|output)\//.test(file)
    || /\.(sqlite3|sqlite3-wal|log|env)(-|$)/.test(file) || file.endsWith('.pyc'));
  assert.deepEqual(junk, [], 'dados e ficheiros de trabalho não se commitam');
  assert.ok(tracked.includes('.gitignore'), 'há .gitignore a proteger as instalações');
  console.log(`· ${tracked.length} ficheiros acompanhados pelo Git, sem dados nem lixo`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('· (Git indisponível — verificação do repositário saltada)');
}

/* 3 · nada do nome ou do modelo antigo ficou em lado nenhum */
const oldNames = ['CartasCore', 'data-core', 'CARTAS_CONFIG', 'CARTAS_', 'Reprovadas', 'Área de produção',
  'Painel de acompanhamento', 'inatro-mark.svg', 'mestre', 'MESTRE', 'Mestre', 'machineLegend', 'dailyChart', 'machineQCInputs'];
// todo o código publicado e a documentação, não só uma lista fixa de ficheiros
const trackedText = ['LEIA-ME.md', ...published.filter((file) => /\.(js|html|css)$/.test(file)).map((file) => `app/${file}`)]
  .map((file) => [file, read(file)]);
for (const name of oldNames) {
  for (const [file, text] of trackedText) {
    assert.ok(!text.includes(name), `${file} ainda menciona «${name}»`);
  }
}
assert.ok(!/cartas\.sqlite3/.test(read('LEIA-ME.md')), 'a documentação fala da base actual');
console.log('· sem restos do sistema anterior no código nem na documentação');

/* 4 · marca INATRO: as mesmas cores no ecrã, no PDF e no logótipo */
const palette = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(([, name, hex]) => [name, hex]));
assert.equal(palette.green, '#0e7a2e', 'o verde do logótipo INATRO manda na interface');
assert.equal(palette['lime'], '#9fd06a');
assert.ok(!/#147d65|#0f766e|#0ea5e9|#f97316|#f59e0b/.test(css + app), 'nem azuis nem laranjas fora da marca');
const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
[...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]).forEach((name) => {
  assert.ok(declared.has(name), `a folha de estilos usa ${name} sem o definir`);
});
const pdfTones = [...pdf.matchAll(/tone\('(#[0-9a-f]{6})'\)/g)].map((match) => match[1]);
assert.ok(pdfTones.includes(palette.green), 'o PDF abre com o verde da marca');
assert.ok(pdfTones.includes(palette.danger), 'o vermelho das rejeições é o mesmo no ecrã e no papel');
assert.deepEqual([...new Set(pdfTones)].filter((hex) => !Object.values(palette).includes(hex)), [], 'o PDF não inventa cores novas');
const tone = (hex) => [1, 3, 5].map((offset) => Math.round(parseInt(hex.slice(offset, offset + 2), 16) / 255 * 1000) / 1000);
assert.deepEqual(tone(palette.green), [0.055, 0.478, 0.18], 'a conversão para o PDF não desvia a cor');
// os logótipos oficiais da instituição, nos dois formatos: PNG transparente para o ecrã,
// JPEG achatado sobre o tint do cabeçalho para embutir no PDF
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const jpg = (file) => { const bytes = fs.readFileSync(path.join(DIST, file)); return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9; };
const brandAssets = ['inatro.png', 'inatro-letterhead.jpg', 'logoina.jpg'];
for (const file of brandAssets) assert.ok(fs.existsSync(path.join(DIST, file)), `falta ${file}`);
assert.ok(fs.readFileSync(path.join(DIST, 'inatro.png')).subarray(0, 4).equals(pngMagic), 'o logótipo do ecrã é o PNG oficial');
assert.ok(jpg('inatro-letterhead.jpg'), 'o logótipo do PDF é um JPEG válido');
assert.ok(jpg('logoina.jpg'), 'o símbolo da barra lateral é um JPEG válido');
for (const file of brandAssets) assert.ok(fs.statSync(path.join(DIST, file)).size < 400_000, `${file} está grande de mais`);
assert.ok(html.includes('logoina.jpg'), 'a barra lateral mostra o símbolo oficial');
const logoUsers = app + ui + reports + read('app/views/report-paper.js');
assert.ok(logoUsers.includes('inatro.png'), 'o papel do relatório mostra o logótipo oficial');
assert.ok(ui.includes('inatro-letterhead.jpg'), 'o PDF embute o logótipo oficial (descarregado pelo ui.js)');
assert.ok(!html.includes('conta-carta-mark') && !app.includes('conta-carta-mark') && !pdf.includes('conta-carta-mark'), 'o símbolo desenhado ficou para trás');
assert.match(css, /\.brand-logo\s*\{[^}]*width:/, 'o logótipo tem tamanho próprio na barra lateral');
console.log('· paleta INATRO partilhada por CSS e PDF; logótipos oficiais nos formatos certos');

/* 5 · nada de texto de ajuda no ecrã; a explicação vive nos 🛈 */
const body = html.slice(html.indexOf('<body>'));
assert.match(body, /class="tip" id="tip"/, 'a caixa de ajuda existe');
assert.ok(!/class="(hint|helper|callout|info-banner|note)"[^>]*>[^<]{20,}/.test(body), 'há texto de apoio solto na página');
const infoInHtml = [...html.matchAll(/data-info="([\w-]+)"/g)].map((match) => match[1]);
// os 🛈 criados no código vivem nas vistas (cada ficheiro faz os seus)
const infoInJs = [
  ...(app + reports + panel + ui).matchAll(/infoButton\('(\w+)'\)/g),
  ...panel.matchAll(/help: '(\w+)'/g),          // e os que cada cartão do painel declara
].map((match) => match[1]);
const used = [...new Set([...infoInHtml, ...infoInJs])];
assert.ok(used.length >= 8, 'a ajuda tem de cobrir os pontos que levantam dúvidas');
const helpBlock = core.match(/const HELP = \{([\s\S]*?)\n  \};/);
assert.ok(helpBlock, 'o mapa de ajuda tem de existir (no core, junto do texto)');
const helpEntries = [...helpBlock[1].matchAll(/^\s{4}(\w+): '([^']*)'/gm)].map(([, key, text]) => ({ key, text }));
used.forEach((key) => assert.ok(helpEntries.some((entry) => entry.key === key), `o botão 🛈 «${key}» não tem texto no mapa de ajuda`));
helpEntries.forEach((entry) => assert.ok(used.includes(entry.key), `a ajuda «${entry.key}» não é usada por ninguém`));
helpEntries.forEach((entry) => {
  assert.match(entry.text, /\.$/, `a ajuda «${entry.key}» não fecha a frase`);
  assert.ok(entry.text.length > 40, `a ajuda «${entry.key}» é curta a mais para explicar seja o que for`);
  assert.doesNotMatch(entry.text, /<[a-z]|\{\{|ⓘ|🛈/, `a ajuda «${entry.key}» leva marcação em vez de texto`);
});
// o 🛈 vive num componente só: lê sempre o mapa do core, e o app empresta-lho
const feedback = read('app/components/feedback.js');
assert.match(feedback, /help\[key\]/, 'os botões de ajuda lêem todos do mesmo mapa');
assert.match(feedback, /function tip\(/, 'a dica do 🛈 é uma só para a aplicação inteira');
assert.match(app, /help: core\.HELP/, 'o texto vive no core; a interface só o mostra');
assert.match(app, /ContaCartaFeedback\.create/, 'a interface usa o componente do retorno ao utilizador');
const infoButtonsInHtml = [...body.matchAll(/<button class="info[^"]*"[^>]*data-info=/g)].length;
assert.equal(infoButtonsInHtml, infoInHtml.length, 'cada botão de ajuda do HTML traz o seu data-info');
assert.doesNotMatch(body, /ⓘ|🛈/, 'o ícone da ajuda é sempre o mesmo (SVG da marca)');
for (const button of body.matchAll(/<button class="info"[^>]*data-info="(\w+)"[^>]*aria-label="([^"]*)"/g)) {
  assert.ok(button[2].length > 8, `o 🛈 «${button[1]}» não diz o que abre`);
}
console.log(`· ${used.length} pontos de ajuda, cada um com frase própria e nenhum texto de apoio no ecrã`);

/* 6 · acessibilidade mínima e linguagem consistente */
assert.match(html, /<html lang="pt-MZ">/, 'a língua da página está declarada');
assert.match(html, /<title>Conta Carta · /, 'o título começa pelo nome do sistema');
assert.match(html, /name="viewport"/);
assert.match(html, /name="description"/);
for (const button of body.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
  const label = button[1].replace(/<[^>]+>/g, '').trim();
  const hasLabel = label.length > 0 || /aria-label=/.test(button[0]);
  assert.ok(hasLabel, `botão sem rótulo: ${button[0].slice(0, 60)}`);
}
for (const input of body.matchAll(/<input\b[^>]*>/g)) {
  assert.match(input[0], /id="[\w-]+"|type="(file|hidden)"/, `input sem identificador: ${input[0].slice(0, 60)}`);
}
assert.doesNotMatch(html, /autofocus/, 'nada rouba o foco ao abrir');
// erros de ortografia que já andaram pela app inteira: a suite não os deixa voltar
const typos = [...(html + app + core + pdf).matchAll(/[Pp]roducção|[Cc]onducção/g)];
assert.deepEqual(typos.map((match) => match[0]), [], 'a app escreve «produção» e «condução» sem c cedilhado a mais');
console.log('· botões e campos rotulados; português de Moçambique declarado');

/* 7 · erros tratados, sem diálogos nativos nem fugas de consola */
for (const [name, source] of Object.entries(scripts)) {
  // `Feedback.confirm(` e `function confirm(` são o diálogo da casa; proíbe-se o nativo do navegador
  for (const native of ['window.alert', 'window.confirm', 'window.prompt']) {
    assert.ok(!source.includes(native), `${name} usa o diálogo nativo ${native}`);
  }
  assert.ok(!/console\.log\(/.test(source), `${name} escreve no consola do utilizador`);
  assert.ok(!/\bdebugger\b|TODO|FIXME|XXX/.test(source), `${name} tem trabalho pendurado no código`);
  assert.ok(!/\bdocument\.write|innerHTML\s*=\s*['"`]</.test(source), `${name} injeta HTML de origem duvidosa`);
}
const generic = ['Ocorreu um erro', 'Erro desconhecido', 'Tente novamente mais tarde', 'Something went wrong', 'Erro: '];
for (const phrase of generic) {
  for (const [name, source] of Object.entries({ ...scripts, css })) {
    assert.ok(!source.includes(phrase), `${name} tem mensagem genérica «${phrase}»`);
  }
}
assert.match(feedback, /function guard\(/, 'as acções passam todas pelo mesmo guarda');
assert.match(read('app/views/wiring.js'), /guard\('navegação'|guard\('interacção'/, 'a interface usa o guarda do componente');
assert.match(app, /sendBeacon\('\/api\/log'/, 'os erros vão para o registo curto do servidor');
console.log('· sem alertas nativos, sem consola suja, sem mensagens genéricas');

/* 7b · datas: escreve-se e lê-se dd/mm/yyyy em todo o lado, nunca à moda do navegador */
assert.ok(!/<input[^>]*type="(date|month)"/.test(html),
  'o index.html não mostra nenhum campo com a data em ISO: o calendário nasce na peça única, escondido');
const dateFields = [...html.matchAll(/<input[^>]*id="(filterMonth|recordDate|filterStart|filterEnd|lotStart|stockDelivered|stockUpdated)"[^>]*>/g)].map((match) => match[0]);
assert.equal(dateFields.length, 7, 'todos os campos de data do index.html estão aqui: filtro, dia, lote e armazém');
dateFields.forEach((tag) => {
  assert.match(tag, /type="text"/, 'os campos de data escrevem-se à mão');
  assert.match(tag, /placeholder="(dd\/mm\/aaaa|mm\/aaaa)"/, 'cada campo mostra o formato aceite');
  assert.match(tag, /inputmode="numeric"/, 'no telemóvel abre o teclado dos números');
});
// uma caixa por data: a peça que traz o calendário do sistema é a mesma em todo o lado
const pickdate = scripts['components/pickdate.js'];
assert.match(pickdate, /type: kind === 'month' \? 'month' : 'date'/, 'o calendário é o do sistema (date/month), não um inventado');
assert.match(pickdate, /class: 'date-native'/, 'e vive escondido dentro da caixa, sem segundo campo à vista');
assert.match(pickdate, /showPicker/, 'abre o calendário do sistema com o botão da caixa');
assert.ok(!/filterMonthPick|filterYearPick|month-pick/.test(html), 'não há uma segunda escolha do mês nem do ano');
assert.equal((html.match(/class="month-pick"/g) || []).length, 0);
assert.match(css, /#filterMonth\b[^{]*\{[^}]*width:/, 'o campo do mês tem largura estável');
assert.match(css, /#filterStart[^{]*\{[^}]*width:/, 'os campos do intervalo têm largura estável');
assert.match(css, /\.date-pick\b/, 'a caixa de data tem estilo próprio (texto + botão no mesmo controlo)');
assert.ok(!/\.month-pick\b/.test(css), 'a lista de meses que repetia a caixa foi apagada do estilo');
// e as vistas ligam todas a mesma caixa (nenhuma inventa o seu campo de data)
const dateUsers = ['components/filter.js', 'views/record-form.js', 'views/lot-form.js', 'views/stock-form.js', 'views/reports.js']
  .filter((file) => /dateBox\(/.test(scripts[file]));
assert.equal(dateUsers.length, 5, `as cinco vistas que escolhem datas usam a caixa única (${dateUsers.join(', ')})`);
assert.ok(!/type: 'date'|type: 'month'/.test(Object.entries(scripts)
  .filter(([file]) => file !== 'components/pickdate.js').map(([, source]) => source).join('\n')),
  'só a peça da caixa de data cria calendários: mais ninguém repete o campo nativo');
const clampFloor = (selector) => {
  const rule = css.match(new RegExp(`\\${selector}\\s*\\{[^}]*?font-size:\\s*clamp\\((\\d+)px`));
  return rule ? Number(rule[1]) : 0;
};
assert.ok(clampFloor('.kpi-value') >= 48, `o número grande do KPI tem de ser legível de longe (tem ${clampFloor('.kpi-value')}px)`);
assert.ok(clampFloor('.machine-grid strong') >= 32, 'os números por máquina acompanham o KPI');
assert.ok(!/type="date"|type="month"/.test(app), 'o app.js não cria campos com a data em ISO à vista');
console.log('· datas escritas em dd/mm/yyyy em todos os campos; números do painel em tamanho de TV');

/* 8 · impressão: só sai o relatório, com o papel todo */
assert.match(css, /@media print\s*\{[\s\S]*\.paper/, 'a folha de estilos tem modo de impressão');
const print = css.slice(css.indexOf('@media print'));
assert.match(print, /\.side|\.top|\.paper-actions/, 'o modo de impressão esconde a aplicação');
assert.match(css, /@page\s*\{[^}]*size:\s*A4/, 'a impressão é em A4');
assert.match(css, /@page\s*\{[^}]*margin/, 'a folha define margens');
assert.match(print, /break-inside:\s*avoid/, 'linhas do relatório não se partem entre páginas');
console.log('· modo de impressão isolado do resto da aplicação');

/* 9 · rede: nada sai deste computador */
const remote = [...(html + css + app + core + pdf).matchAll(/https?:\/\/[^"' )]+/g)].map((match) => match[0]);
assert.deepEqual(remote, [], 'a aplicação não pode buscar nada lá fora');
assert.doesNotMatch(app + core + pdf, /fetch\(['"`]https?:/, 'pedidos só podem ser locais');
assert.doesNotMatch(app, /localStorage\.(setItem|removeItem)\((?!STORAGE_KEY)/, 'o armazenamento local usa uma só chave');
console.log('· zero dependências externas: funciona na sala, sem internet');

/* 10 · o nome e a assinatura em todos os documentos gerados */
assert.match(app, /Conta Carta/, 'o nome aparece na aplicação');
assert.match(pdf, /Relatório de produção/, 'o relatório tem título próprio');
assert.match(core, /'Sistema', 'Conta Carta · INATRO, IP'/, 'o CSV assina a origem');
assert.match(html, /class="brand-product">Conta Carta</, 'o logótipo lateral mostra o nome');
assert.match(html, /class="brand-org">INATRO, IP</, 'a instituição aparece na barra lateral');
assert.match(read('app/views/export.js'), /printReport/, 'há botão de impressão no relatório');
console.log('· «Conta Carta» assinatura o ecrã, o PDF e o CSV');

/* 11 · o manual é o único documento entregue, e o repositório não leva ajudas */
const manualPdf = path.join(ROOT, 'docs', 'manual-do-utilizador.pdf');
assert.ok(fs.existsSync(manualPdf), 'falta o manual em docs/manual-do-utilizador.pdf');
const manualBytes = fs.readFileSync(manualPdf);
assert.equal(manualBytes.subarray(0, 8).toString('latin1'), '%PDF-1.4', 'o manual tem de ser um PDF legível');
assert.ok(manualBytes.subarray(-32).toString('latin1').includes('%%EOF'), 'o manual está completo (fim de ficheiro)');
const manualText = manualBytes.toString('latin1');
const manualPages = Number((manualText.match(/\/Count\s+(\d+)/) || [])[1] || 0);
assert.ok(manualPages >= 6 && manualPages <= 20, `o manual tem ${manualPages} páginas: nem solto, nem testamento`);
// As metadagens vivem no dicionário /Info referido pelo trailer; os marcadores (outline) têm /Title próprios
const infoRef = manualText.match(/\/Info\s+(\d+)\s+0\s+R/);
assert.ok(infoRef, 'o manual tem dicionário de metadagens (/Info)');
const infoObject = manualText.match(new RegExp(`${infoRef[1]} 0 obj([\\s\\S]*?)endobj`));
assert.ok(infoObject, 'o objecto de metadagens é legível');
const meta = Object.fromEntries([...infoObject[1].matchAll(/\/(Title|Author|Creator)\s*\(([^)]*)\)/g)]
  .map(([, key, value]) => [key, value.replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))]));
assert.match(meta.Title || '', /Conta Carta/, 'o título do PDF é o do sistema');
assert.match(meta.Author || '', /INATRO/, 'e o autor é a instituição');
assert.ok(!/ferramentas\/|gerar-manual|gerar-logo|refs\/|\/tmp\//i.test(manualText),
  'o documento entregue não menciona pastas de trabalho nem guiões internos');
const docxPath = path.join(ROOT, 'docs', 'manual-do-utilizador.docx');
assert.ok(fs.existsSync(docxPath), 'falta o manual em Word: docs/manual-do-utilizador.docx');
const docxBytes = fs.readFileSync(docxPath);
assert.equal(docxBytes.subarray(0, 4).toString('latin1'), 'PK\x03\x04', 'o manual em Word tem de ser um .docx legível');
assert.ok(docxBytes.length > 40_000, 'o manual em Word não pode ser uma casca vazia');
const docs = fs.readdirSync(path.join(ROOT, 'docs')).sort();
assert.deepEqual(docs, ['manual-do-utilizador.docx', 'manual-do-utilizador.pdf'], 'em docs/ ficam os dois formatos do manual e mais nada');
const junkDirs = ['tools', 'refs', 'tmp', 'output', 'image-search'].filter((dir) => fs.existsSync(path.join(ROOT, dir)));
assert.deepEqual(junkDirs, [], `${junkDirs.join(', ')} são auxílio de quem constrói, não parte do sistema`);
console.log(`· docs/ só com o manual (${manualPages} páginas em PDF + Word); ferramentas/ tem os geradores`);

console.log('\nInterface estática verificada: ficheiros, marca, ajuda, erros, impressão, privacidade e manual.');
