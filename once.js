const { chromium } = require('playwright');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));

(async () => {
  const b = await chromium.launch({ headless: true });
  const opts = { viewport: { width: 420, height: 900 } };
  if (fs.existsSync('state.json') && fs.statSync('state.json').size > 100) opts.storageState = 'state.json';
  const c = await b.newContext(opts);
  const p = await c.newPage();
  await p.goto('https://mine.sible.network/', { waitUntil: 'networkidle' });

  const navExt = p.getByText(/^\s*Extension\s*$/i).first();
  const navRef = p.getByText(/^\s*Referral\s*$/i).first();
  const popupTxt = p.getByText(/Now live on Google Play|Get it on Google Play/i).first();
  const popupUp = () => popupTxt.isVisible().catch(() => false);

  // gol ball ki jagah (Extension aur Referral ke beech, thora upar)
  async function ballPoint() {
    const e = await navExt.boundingBox();
    const r = await navRef.boundingBox();
    return { x: (e.x + e.width / 2 + r.x + r.width / 2) / 2, y: e.y + e.height / 2 - 24 };
  }

  // Ad popup band karo (Escape -> close button -> X wali jagah click)
  async function closePopup() {
    for (let i = 0; i < 3; i++) {
      if (!(await popupUp())) return;
      console.log('Popup mila, band kar raha hoon (try ' + (i + 1) + ')');
      if (i === 0) await p.screenshot({ path: 'popup.png' });
      await p.keyboard.press('Escape').catch(() => {});
      await sleep(1000);
      if (!(await popupUp())) return;
      await p.locator('[aria-label*="close" i], [class*="close" i]').first()
        .click({ timeout: 2000 }).catch(() => {});
      await sleep(1000);
      if (!(await popupUp())) return;
      const pt = await ballPoint().catch(() => null);
      if (pt) await p.mouse.click(pt.x, pt.y);   // X button usi jagah hota hai
      await sleep(1500);
    }
    if (await popupUp()) console.log('WARNING: popup band nahi ho saka (popup.png dekho)');
  }

  // 1) login check
  await navExt.waitFor({ timeout: 25000 }).catch(() => {});
  if (!(await navExt.isVisible().catch(() => false))) {
    await p.screenshot({ path: 'login_needed.png' });
    console.log('LOGIN STATUS: LOGGED OUT - session expire ho gaya.');
    console.log('Fix: PC par "node login.js" chalao, naya state_b64.txt GitHub secret STATE_B64 me update karo.');
    await b.close();
    process.exit(1);
  }
  console.log('LOGIN STATUS: logged in');

  await sleep(4000);
  await closePopup();                              // popup sab se pehle band

  const getCd = () => p.evaluate(() =>
    (document.body.innerText.match(/Next session in\s*(\d+:\d+:\d+)/i) || [])[1]);

  let cd = await getCd();

  // 2) countdown nahi = session ready -> gol ball dabao
  if (!cd) {
    await sleep(rnd(30, 240) * 1000);              // jitter
    await closePopup();                            // popup dobara aa gaya ho to
    const pt = await ballPoint();
    await p.screenshot({ path: 'before.png' });
    await p.mouse.click(pt.x, pt.y);
    console.log('Ball clicked at', Math.round(pt.x), Math.round(pt.y));
    await sleep(5000);
    await closePopup();
    await p.screenshot({ path: 'after.png' });
    cd = await getCd();
    console.log('Countdown after click:', cd || 'NAHI AAYA (click shayad nahi laga)');
  } else {
    console.log('Session chal raha hai, next in', cd);
  }

  // 3) Accelerate buttons dikhen to 3 dafa dabao, 30s ke gap se
  const acc = p.getByText(/^\s*accelerate\s*$/i);   // "Accelerated" match nahi hoga
  for (let i = 0; i < 3; i++) {
    await closePopup();
    if ((await acc.count()) > 0 && await acc.first().isVisible().catch(() => false)) {
      await acc.first().click();
      console.log('Accelerate', i + 1);
      await sleep((30 + rnd(0, 5)) * 1000);
    } else break;
  }

  await b.close();
})();
