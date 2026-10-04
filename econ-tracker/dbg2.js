const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('response', async r => { const u=r.url(); if(u.includes('/api/jolts/')) console.log('RESP', r.status(), u.replace('http://127.0.0.1:5183','')); });
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'US JOLTS')?.click());
  await new Promise(r => setTimeout(r, 3500));
  console.log('--- clicking By region ---');
  await p.evaluate(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='By region'); btn && btn.click(); });
  await new Promise(r => setTimeout(r, 3500));
  const firstRow = await p.evaluate(() => {
    // find the breakdown panel by its "Breakdown" heading, read first data label
    const spans=[...document.querySelectorAll('span')].map(s=>s.textContent.trim());
    return spans.filter(t=>/region$/.test(t)).slice(0,5);
  });
  console.log('region spans:', JSON.stringify(firstRow));
  await b.close();
})();
