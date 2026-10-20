const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('console', m => { const t=m.text(); if(t.includes('BREAKDOWN')) console.log(t); });
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'US JOLTS')?.click());
  await new Promise(r => setTimeout(r, 2500));
  console.log('=== click By region ===');
  await p.evaluate(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='By region'); btn && btn.click(); });
  await new Promise(r => setTimeout(r, 2500));
  const shown = await p.evaluate(() => document.body.innerText.match(/(South region|Total nonfarm)/)?.[0]);
  console.log('first-match shown:', shown);
  await b.close();
})();
