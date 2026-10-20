const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1600, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  p.on('console', m => { if (m.type()==='error') console.log('CONSOLE-ERR:', m.text()); });
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));
  // click the "US PPI" toggle
  const clicked = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'US PPI');
    if (btn) { btn.click(); return true; } return false;
  });
  console.log('clicked US PPI:', clicked);
  await new Promise(r => setTimeout(r, 2200));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/preview-ppi.png', fullPage: true });
  console.log('shot saved');
  await b.close();
})();
