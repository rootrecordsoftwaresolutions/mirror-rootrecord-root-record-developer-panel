'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const text = fs.readFileSync(mainPath, 'utf8');
const marker = "mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`";
const start = text.indexOf(marker);
if (start < 0) throw new Error('loadURL marker not found');
const tickStart = text.indexOf('`', start);
const tickEnd = text.indexOf('`));', tickStart);
if (tickStart < 0 || tickEnd < 0) throw new Error('template bounds not found');
const html = text.slice(tickStart + 1, tickEnd);
const scriptStart = html.indexOf('<script>');
const scriptEnd = html.indexOf('</script>');
if (scriptStart < 0 || scriptEnd < 0) throw new Error('script tags not found');
let js = html.slice(scriptStart + '<script>'.length, scriptEnd);
js = js.replace(/\$\{JSON\.stringify\(developmentFolder\)\}/g, '"X"');
js = js.replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
try {
  new vm.Script(js);
  console.log('renderer script: parse OK');
} catch (err) {
  console.error('renderer script parse failed:', err.message);
  if (typeof err.stack === 'string') console.error(err.stack);
  process.exit(1);
}
