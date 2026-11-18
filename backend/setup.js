'use strict';

const readline = require('node:readline');
const { stdin, stdout } = require('node:process');
const { setPassword } = require('./modules/auth');

async function main() {
  if (!stdin.isTTY) throw new Error('Execute npm run setup num terminal interactivo.');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    console.log('Configuração das contas Conta Carta (mínimo 6 caracteres por palavra-passe).');
    // Não mostrar as palavras-passe durante a escrita no terminal.
    const originalWrite = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (value) => {
      if (!rl._secret) originalWrite(value);
      else if (value.includes('\n') || value.includes('\r')) stdout.write('\n');
    };
    const secret = async (question) => {
      stdout.write(question);
      rl._secret = true;
      try { return await new Promise((resolve) => rl.question('', resolve)); }
      finally { rl._secret = false; stdout.write('\n'); }
    };
    for (const [role, label] of [['pca', 'PCA (consulta)'], ['fabrica', 'Fábrica (registo e consulta)']]) {
      const password = await secret(`Palavra-passe para ${label}: `);
      const confirmation = await secret('Confirmar palavra-passe: ');
      if (password !== confirmation) throw new Error('As palavras-passe não coincidem. Repete a configuração.');
      setPassword(role, password);
    }
    console.log('Contas configuradas. Inicie com npm start.');
  } finally { rl.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
