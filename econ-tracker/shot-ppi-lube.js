const puppeteer = require('puppeteer');
const click = async (p, txt) => p.evaluate((t) => {
  const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
  if (el) { el.click(); return true; } return false;
}, txt);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1400));
  console.log('US PPI:', await click(p, 'US PPI'));
  await new Promise(r => setTimeout(r, 1200));
  console.log('Commodities:', await click(p, 'Commodities'));
  await new Promise(r => setTimeout(r, 1600));
  console.log('Fuels:', await click(p, 'Fuels and related'));
  await new Promise(r => setTimeout(r, 1500));
  console.log('Petroleum:', await click(p, 'Petroleum products, refined'));
  await new Promise(r => setTimeout(r, 1500));
  console.log('Lube:', await click(p, 'Lubricating oil base stocks'));
  await new Promise(r => setTimeout(r, 1500));
  console.log('Max:', await click(p, 'Max'));
  await new Promise(r => setTimeout(r, 1800));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/preview-ppi-lube.png', fullPage: true });
  console.log('shot saved');
  await b.close();
})();
