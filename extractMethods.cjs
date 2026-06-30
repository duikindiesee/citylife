const fs = require('fs');

const code = fs.readFileSync('src/colony/render/PlanetRenderer.ts', 'utf-8');

const methodRegex = /^(?:  |)(?:private |public |protected |)(?:async )?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?::\s*[a-zA-Z0-9_<>|\s\[\]]+)?\s*\{/gm;

const methods = [];
let match;
while ((match = methodRegex.exec(code)) !== null) {
  if (['constructor', 'if', 'for', 'while', 'switch', 'catch', 'function'].includes(match[1])) continue;
  methods.push(match[1]);
}

const uniqueMethods = [...new Set(methods)];
console.log(JSON.stringify(uniqueMethods, null, 2));
