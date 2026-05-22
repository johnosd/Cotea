const fs = require('fs');
const path = require('path');

const adminJsPath = path.join(__dirname, 'pages', 'admin.js');
const pagesPath = path.join(__dirname, 'pages');

function listarEstrutura(dir, prefix = '') {
  const itens = fs.readdirSync(dir, { withFileTypes: true });
  itens.forEach((item) => {
    const itemPath = path.join(dir, item.name);
    console.log(prefix + (item.isDirectory() ? '📁 ' : '📄 ') + item.name);
    if (item.isDirectory()) {
      listarEstrutura(itemPath, prefix + '  ');
    }
  });
}

function main() {
  if (fs.existsSync(adminJsPath)) {
    fs.unlinkSync(adminJsPath);
    console.log('Arquivo pages/admin.js removido.');
  } else {
    console.log('Arquivo pages/admin.js não encontrado.');
  }

  console.log('\nEstrutura da pasta pages:\n');
  listarEstrutura(pagesPath);
}

main();
