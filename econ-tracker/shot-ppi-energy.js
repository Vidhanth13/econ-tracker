const puppeteer = require('puppeteer');
const clickText = async (p, txt) => p.evaluate((t) => {
  const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
  if (el) { el.click(); return true; } return false;
}, txt);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1700, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1400));
  console.log('US PPI:', await clickText(p, 'US PPI'));
  await new Promise(r => setTimeout(r, 1600));
  console.log('goods:', await clickText(p, 'Final demand goods'));   // drill via sub-breakdown
  await new Promise(r => setTimeout(r, 1600));
  console.log('energy:', await clickText(p, 'Final demand energy')); // drill again
  await new Promise(r => setTimeout(r, 1900));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/preview-ppi-energy.png', fullPage: true });
  console.log('shot saved');
  await b.close();
})();
