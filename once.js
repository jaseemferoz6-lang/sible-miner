const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ storageState: 'state.json', viewport: { width: 420, height: 900 } });
  const p = await c.newPage();
  await p.goto('https://mine.sible.network/', { waitUntil: 'networkidle' });

  // bottom nav dikhne tak intezar
  await p.getByText(/^\s*Extension\s*$/i).first().waitFor({ timeout: 30000 });
  await sleep(4000);

  const getCd = () => p.evaluate(() =>
    (document.body.innerText.match(/Next session in\s*(\d+:\d+:\d+)/i) || [])[1]);

  let cd = await getCd();

  // 1) countdown nahi = session ready -> beech wala gol ball dabao
  if (!cd) {
    await sleep(rnd(30, 240) * 1000);              // jitter
    const ext = await p.getByText(/^\s*Extension\s*$/i).first().boundingBox();
    const ref = await p.getByText(/^\s*Referral\s*$/i).first().boundingBox();
    const x = (ext.x + ext.width / 2 + ref.x + ref.width / 2) / 2;
    const y = ext.y + ext.height / 2 - 24;         // ball text se thora upar hai
    await p.screenshot({ path: 'before.png' });
    await p.mouse.click(x, y);
    console.log('Ball clicked at', Math.round(x), Math.round(y));
    await sleep(5000);
    await p.screenshot({ path: 'after.png' });
    cd = await getCd();
    console.log('Countdown after click:', cd || 'NAHI AAYA (click shayad nahi laga)');
  } else {
    console.log('Session chal raha hai, next in', cd);
  }

  // 2) Accelerate buttons dikhen to 3 dafa dabao, 30s ke gap se
  const acc = p.getByText(/^\s*accelerate\s*$/i);  // "Accelerated" match nahi hoga
  for (let i = 0; i < 3; i++) {
    if ((await acc.count()) > 0 && await acc.first().isVisible().catch(() => false)) {
      await acc.first().click();
      console.log('Accelerate', i + 1);
      await sleep((30 + rnd(0, 5)) * 1000);
    } else break;
  }

  await b.close();
})();
