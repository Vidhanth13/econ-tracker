const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1580, height: 430, deviceScaleFactor: 2 });
  const f = 'file:///' + path.resolve('C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/diagram-preview.html').split(path.sep).join('/');
  await p.goto(f, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/architecture.png' });
  console.log('saved');
  await b.close();
})();
