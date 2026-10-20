const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  p.on('console', m => { if (m.type()==='error') console.log('CONSOLE-ERR:', m.text()); });
  await p.goto('http://127.0.0.1:5183/?view=chart', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2500));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/preview-chart.png' });
  // hover across the chart to trigger a marker tooltip
  await p.mouse.move(1100, 400);
  await new Promise(r => setTimeout(r, 400));
  for (let x = 1100; x > 300; x -= 12) { await p.mouse.move(x, 400); await new Promise(r => setTimeout(r, 15)); }
  await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: 'C:/Users/sbhee/.openclaw/workspace/services/econ-tracker/preview-chart-hover.png' });
  console.log('shots saved');
  await b.close();
})();
