const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1600, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1200));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'US JOLTS')?.click());
  await new Promise(r => setTimeout(r, 2500));
  const clicked = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'By region');
    if (btn) { btn.click(); return true; } return false;
  });
  console.log('clicked By region:', clicked);
  await new Promise(r => setTimeout(r, 2500));
  // scroll breakdown into view
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 800));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/preview-jolts-region.png', fullPage: true });
  console.log('shot saved');
  await b.close();
})();
