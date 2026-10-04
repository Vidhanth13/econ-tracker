const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('console', m => console.log('CONSOLE', m.type(), m.text()));
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://127.0.0.1:5183/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1000));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'US JOLTS')?.click());
  await new Promise(r => setTimeout(r, 2500));
  const before = await p.evaluate(() => document.body.innerText.includes('Mining and logging'));
  console.log('industry visible before region:', before);
  const ok = await p.evaluate(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='By region'); if(btn){btn.click();return true;}return false;});
  console.log('clicked region:', ok);
  await new Promise(r => setTimeout(r, 3000));
  const rows = await p.evaluate(() => {
    const heads = [...document.querySelectorAll('div')].filter(d=>d.textContent.trim().startsWith('Breakdown'));
    return document.body.innerText.split('\n').filter(l=>/region|Mining|Total nonfarm/.test(l)).slice(0,8);
  });
  console.log('ROWS:', JSON.stringify(rows));
  await b.close();
})();
