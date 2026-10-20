const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1200, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1000));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'US JOLTS')?.click());
  await new Promise(r => setTimeout(r, 2500));
  // select Construction in the trend industry dropdown
  const sel = await p.evaluate(() => {
    const s = document.querySelector('select');
    const opt = [...s.options].find(o => o.textContent.trim() === 'Construction');
    if (!opt) return false;
    s.value = opt.value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.value;
  });
  console.log('selected industry value:', sel);
  await new Promise(r => setTimeout(r, 2500));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/preview-jolts-ind.png' });
  console.log('shot saved');
  await b.close();
})();
