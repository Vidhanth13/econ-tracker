const puppeteer = require('puppeteer');
const clickText = async (p, txt) => p.evaluate((t) => {
  const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
  if (el) { el.click(); return true; } return false;
}, txt);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1750, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1400));
  console.log('US PPI:', await clickText(p, 'US PPI'));
  await new Promise(r => setTimeout(r, 1400));
  console.log('Commodities:', await clickText(p, 'Commodities'));
  await new Promise(r => setTimeout(r, 1700));
  console.log('Fuels:', await clickText(p, 'Fuels and related'));
  await new Promise(r => setTimeout(r, 1600));
  console.log('Max range:', await clickText(p, 'Max'));
  await new Promise(r => setTimeout(r, 1800));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/preview-ppi-commodity.png', fullPage: true });
  console.log('shot saved');
  await b.close();
})();
