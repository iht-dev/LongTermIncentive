const path = require('path');
const solc = require('solc');
const fs = require('fs-extra');

const buildPath = path.resolve(__dirname, 'build');
fs.removeSync(buildPath);

// 编译一个合约，里面包含需要编译的其他合约
INDEX_SOL_FILENAME = 'Index.sol'

function compileSolFile(fileName) {
  // 读取sol文件的文本
  const source = findImports(fileName).contents
  const input = {}
  input[fileName] = source

  // 编译
  const compile = solc.compile({sources: input}, 1, findImports) // see: https://www.npmjs.com/package/solc   search txt: findImports

  if (compile.errors) {
    console.log(compile.errors.join('\n'));
  }
  const output = compile.contracts;

  // 输出json到build目录
  fs.ensureDirSync(buildPath);
  for (let contract in output) {
    pathJson = path.resolve(buildPath, contract.split(':').slice(-1)[0] + '.json')
    fs.outputJsonSync(
      // contract 例如：SafeMath.sol:SafeMath，使用`:`后面的名称（SafeMath）命名
      pathJson,
      output[contract]
    );
    console.log(`compile -> ${pathJson}`)
  }
}

function findImports(fileName) {
  const solPath = path.resolve(__dirname, 'contracts', fileName);
  const source = fs.readFileSync(solPath, 'utf8');
  return { contents: source }
}

// 编译合约
compileSolFile(INDEX_SOL_FILENAME)

