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
const DIST = path.join(ROOT, 'dist');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const html = read('dist/index.html');
const css = read('dist/style.css');
const app = read('dist/app.js');
const core = read('dist/core.js');
const pdf = read('dist/pdf.js');
const scripts = { app, core, pdf };

/* 1 · tudo o que a página carrega existe, e nada fica para trás */
const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((src) => !src.startsWith('http'));
const files = fs.readdirSync(DIST).sort();
referenced.forEach((src) => assert.ok(files.includes(src), `${src} é carregado pela página mas não existe`));
const expectedFiles = ['app.js', 'config.js', 'core.js', 'index.html', 'conta-carta-mark.svg', 'pdf.js', 'sample.json', 'seed.json', 'style.css'];
assert.deepEqual(files, expectedFiles.slice().sort(), 'a pasta publicada só contém o que a aplicação usa');
files.filter((file) => file.endsWith('.js')).forEach((file) => {
  assert.ok(read(`dist/${file}`).length < 120_000, `${file} está grande de mais`);
});
console.log(`· ${files.length} ficheiros em dist/, todos usados, nenhum a mais`);

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
const trackedText = ['dist/index.html', 'dist/app.js', 'dist/style.css', 'dist/core.js', 'dist/pdf.js', 'LEIA-ME.md']
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
const logoTones = ['#4cb050', '#808080', '#4a4a4a'];
assert.ok(pdfTones.includes(palette.green), 'o PDF abre com o verde da marca');
assert.ok(pdfTones.includes(palette.danger), 'o vermelho das rejeições é o mesmo no ecrã e no papel');
assert.deepEqual([...new Set(pdfTones)].filter((hex) => !Object.values(palette).includes(hex)
  && !logoTones.includes(hex)), [], 'o PDF não inventa cores novas');
const tone = (hex) => [1, 3, 5].map((offset) => Math.round(parseInt(hex.slice(offset, offset + 2), 16) / 255 * 1000) / 1000);
assert.deepEqual(tone(palette.green), [0.055, 0.478, 0.18], 'a conversão para o PDF não desvia a cor');
assert.ok(html.includes('conta-carta-mark.svg') && fs.existsSync(path.join(DIST, 'conta-carta-mark.svg')), 'o logótipo está no sítio');
const svg = read('dist/conta-carta-mark.svg');
assert.match(svg, /viewBox/, 'o logótipo é vectorial');
assert.ok(!/<image|href="http/.test(svg), 'o logótipo não depende de ficheiros externos');
assert.ok(!/<text|font-family/.test(svg), 'o logótipo não depende de tipos de letra');
assert.match(svg, /aria-label="[^"]*velocímetro[^"]*"/, 'o logótipo diz o que é a quem não o vê');
const svgColors = [...new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((match) => match[1]))].sort();
assert.ok(svgColors.length >= 6, 'a escala do velocímetro traz mais de seis cores');
for (const hex of logoTones) assert.ok(svgColors.includes(hex), `o logótipo mantém a cor ${hex} do símbolo`);
assert.ok(svgColors.every((hex) => /^#[0-9a-f]{6}$/.test(hex)), 'as cores do logótipo são hexadecimais de seis dígitos');
// o PDF desenha o mesmo símbolo a partir das mesmas medidas: não pode divergir
for (const hex of svgColors) {
  assert.ok(pdf.includes(hex), `o PDF não conhece a cor ${hex} do logótipo`);
}
const box = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
const markHeight = Number(pdf.match(/const MARK = \{\s*height: ([\d.]+),/)[1]);
assert.ok(Math.abs(markHeight / 100 - box[2] / box[1]) < 0.01, 'a proporção do logótipo no PDF é a do SVG');
assert.match(css, /\.brand-logo\s*\{[^}]*width:/, 'o logótipo tem tamanho próprio na barra lateral');
console.log('· paleta INATRO partilhada por CSS, PDF e logótipo vectorial');

/* 5 · nada de texto de ajuda no ecrã; a explicação vive nos 🛈 */
const body = html.slice(html.indexOf('<body>'));
assert.match(body, /class="tip" id="tip"/, 'a caixa de ajuda existe');
assert.ok(!/class="(hint|helper|callout|info-banner|note)"[^>]*>[^<]{20,}/.test(body), 'há texto de apoio solto na página');
const infoInHtml = [...html.matchAll(/data-info="([\w-]+)"/g)].map((match) => match[1]);
const infoInJs = [
  ...app.matchAll(/infoButton\('(\w+)'\)/g),   // botões criados no código
  ...app.matchAll(/help: '(\w+)'/g),            // e os que cada cartão do painel declara
].map((match) => match[1]);
const used = [...new Set([...infoInHtml, ...infoInJs])];
assert.ok(used.length >= 8, 'a ajuda tem de cobrir os pontos que levantam dúvidas');
const helpBlock = app.match(/const HELP = \{([\s\S]*?)\n  \};/);
assert.ok(helpBlock, 'o mapa de ajuda tem de existir');
const helpEntries = [...helpBlock[1].matchAll(/^\s{4}(\w+): '([^']*)'/gm)].map(([, key, text]) => ({ key, text }));
used.forEach((key) => assert.ok(helpEntries.some((entry) => entry.key === key), `o botão 🛈 «${key}» não tem texto no mapa de ajuda`));
helpEntries.forEach((entry) => assert.ok(used.includes(entry.key), `a ajuda «${entry.key}» não é usada por ninguém`));
helpEntries.forEach((entry) => {
  assert.match(entry.text, /\.$/, `a ajuda «${entry.key}» não fecha a frase`);
  assert.ok(entry.text.length > 40, `a ajuda «${entry.key}» é curta a mais para explicar seja o que for`);
  assert.doesNotMatch(entry.text, /<[a-z]|\{\{|ⓘ|🛈/, `a ajuda «${entry.key}» leva marcação em vez de texto`);
});
assert.match(app, /HELP\[key\]|HELP\[button\.dataset\.info\]/, 'os botões 🛈 lêem todos do mesmo mapa');
assert.equal((body.match(/🛈/g) || []).length, infoInHtml.length, 'cada 🛈 corresponde a um botão de ajuda');
assert.doesNotMatch(body, /ⓘ/, 'o símbolo da ajuda é sempre o mesmo');
for (const button of body.matchAll(/<button class="info"[^>]*data-info="(\w+)"[^>]*aria-label="([^"]*)"/g)) {
  assert.ok(button[2].length > 8, `o 🛈 «${button[1]}» não diz o que abre`);
}
console.log(`· ${used.length} pontos de ajuda, cada um com frase própria e nenhuma ajuda à vista`);

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
console.log('· botões e campos rotulados; português de Moçambique declarado');

/* 7 · erros tratados, sem diálogos nativos nem fugas de consola */
for (const [name, source] of Object.entries(scripts)) {
  assert.ok(!/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/.test(source), `${name} usa diálogos nativos`);
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
assert.match(app, /function guard\(/, 'as acções passam todas pelo mesmo protection');
assert.match(app, /sendBeacon\('\/api\/log'/, 'os erros vão para o registo curto do servidor');
console.log('· sem alertas nativos, sem consola suja, sem mensagens genéricas');

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
assert.match(app, /@media print|printReport/, 'há botão de impressão no relatório');
console.log('· «Conta Carta» assinatura o ecrã, o PDF e o CSV');

/* 11 · o manual é o único documento entregue, e o repositório não leva ajudas */
const manualPdf = path.join(ROOT, 'docs', 'manual-do-utilizador.pdf');
assert.ok(fs.existsSync(manualPdf), 'falta o manual em docs/manual-do-utilizador.pdf');
const manualBytes = fs.readFileSync(manualPdf);
assert.equal(manualBytes.subarray(0, 8).toString('latin1'), '%PDF-1.4', 'o manual tem de ser um PDF legível');
assert.ok(manualBytes.subarray(-32).toString('latin1').includes('%%EOF'), 'o manual está completo (fim de ficheiro)');
const manualText = manualBytes.toString('latin1');
const manualPages = (manualText.match(/\/Type\s*\/Page[^s]/g) || []).length;
assert.ok(manualPages >= 10 && manualPages <= 24, `o manual tem ${manualPages} páginas: nem solto, nem testamento`);
const meta = Object.fromEntries([...manualText.matchAll(/\/(Title|Author|Creator)\s*\(([^)]*)\)/g)]
  .map(([, key, value]) => [key, value.replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))]));
assert.match(meta.Title || '', /Conta Carta/, 'o título do PDF é o do sistema');
assert.match(meta.Author || '', /INATRO/, 'e o autor é a instituição');
assert.ok(!/tools\/|gerar-manual|gerar-logo|refs\/|\/tmp\//i.test(manualText),
  'o documento entregue não menciona pastas de trabalho nem guiões internos');
const docs = fs.readdirSync(path.join(ROOT, 'docs')).sort();
assert.deepEqual(docs, ['manual-do-utilizador.pdf'], 'em docs/ só fica o manual: sem imagens intermédias nem exportações');
const junkDirs = ['tools', 'refs', 'tmp', 'output', 'image-search'].filter((dir) => fs.existsSync(path.join(ROOT, dir)));
assert.deepEqual(junkDirs, [], `${junkDirs.join(', ')} são auxílio de quem constrói, não parte do sistema`);
console.log(`· docs/ só com o manual (${manualPages} páginas), sem pastas de auxílio no repositório`);

console.log('\nInterface estática verificada: ficheiros, marca, ajuda, erros, impressão, privacidade e manual.');
