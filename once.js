const { chromium } = require('playwright');
const fs = require('fs');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));

const EMAIL = process.env.SIBLE_EMAIL;
const PASS = process.env.SIBLE_PASS;
const IMAP_USER = process.env.OTP_IMAP_USER;
const IMAP_PASS = process.env.OTP_IMAP_PASS;

// Gmail (IMAP) se Sible ka 6-digit OTP parho. since = login dabane ka waqt (ms)
async function fetchOtp(since, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    let client;
    try {
      client = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: IMAP_USER, pass: IMAP_PASS }, logger: false,
      });
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search(
          { subject: 'sign-in code', since: new Date(Date.now() - 86400000) }, { uid: true });
        for (const uid of [...uids].sort((a, b) => b - a)) {
          const m = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
          if (new Date(m.internalDate).getTime() < since - 20000) continue;   // purani email
          const parsed = await simpleParser(m.source);
          const text = (parsed.text || '') + ' ' + (parsed.subject || '');
          const hit = text.match(/verification code\s*[:\-]?\s*(\d{6})/i) || text.match(/\b(\d{6})\b/);
          if (hit) return hit[1];
        }
      } finally { lock.release(); }
    } catch (e) {
      console.log('IMAP error:', e.message);
    } finally {
      if (client) await client.logout().catch(() => {});
    }
    await sleep(5000);
  }
  return null;
}

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

  async function ballPoint() {
    const e = await navExt.boundingBox();
    const r = await navRef.boundingBox();
    return { x: (e.x + e.width / 2 + r.x + r.width / 2) / 2, y: e.y + e.height / 2 - 24 };
  }

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
      if (pt) await p.mouse.click(pt.x, pt.y);
      await sleep(1500);
    }
    if (await popupUp()) console.log('WARNING: popup band nahi ho saka (popup.png dekho)');
  }

  async function fail(msg) {
    await p.screenshot({ path: 'login_failed.png' }).catch(() => {});
    console.log('LOGIN FAILED: ' + msg);
    fs.writeFileSync('login_failed.flag', '1');
    await b.close();
    process.exit(1);
  }

  // Auto-login: email + password + Gmail se OTP
  async function autoLogin() {
    if (!EMAIL || !PASS || !IMAP_USER || !IMAP_PASS)
      return fail('secrets nahi mile (SIBLE_EMAIL, SIBLE_PASS, OTP_IMAP_USER, OTP_IMAP_PASS).');

    if (!/\/login/.test(p.url())) await p.goto('https://mine.sible.network/login', { waitUntil: 'networkidle' });
    let startedAt = Date.now();

    await p.locator('input:not([type="password"]):not([type="hidden"])').first().fill(EMAIL, { timeout: 10000 })
      .catch(() => fail('email box nahi mila'));
    await p.locator('input[type="password"]').first().fill(PASS, { timeout: 10000 })
      .catch(() => fail('password box nahi mila'));
    await p.getByRole('button', { name: /^log ?in$/i }).first().click({ timeout: 10000 })
      .catch(() => fail('Login button nahi mila'));

    await p.waitForURL(/verify-otp/, { timeout: 20000 })
      .catch(() => fail('OTP screen nahi aayi (galat password ya captcha?)'));
    console.log('OTP screen aa gayi, Gmail se code dhoond raha hoon...');

    let code = await fetchOtp(startedAt, 75000);
    if (!code) {
      console.log('Code nahi mila, Resend try kar raha hoon...');
      startedAt = Date.now();
      await p.getByText(/resend/i).first().click({ timeout: 5000 }).catch(() => {});
      code = await fetchOtp(startedAt, 60000);
    }
    if (!code) return fail('OTP email nahi mili (forward filter / spam / app password check karo).');
    console.log('OTP mil gaya, daal raha hoon.');

    const boxes = p.locator('input');
    if ((await boxes.count()) >= 6) {
      for (let i = 0; i < 6; i++) await boxes.nth(i).fill(code[i]);
    } else {
      await boxes.first().click();
      await p.keyboard.type(code, { delay: 150 });
    }
    await sleep(800);
    await p.getByRole('button', { name: /^next$/i }).first().click({ timeout: 5000 }).catch(() => {});

    await navExt.waitFor({ timeout: 30000 }).catch(() => {});
    if (!(await navExt.isVisible().catch(() => false))) return fail('OTP daalne ke baad Home page nahi aaya.');

    await c.storageState({ path: 'state.json', indexedDB: true });   // naya session
    fs.writeFileSync('relogin.flag', '1');                            // workflow secret update karega
    console.log('AUTO-LOGIN kamyab, naya session save ho gaya.');
  }

  // 1) login check
  await navExt.waitFor({ timeout: 25000 }).catch(() => {});
  if (!(await navExt.isVisible().catch(() => false))) {
    console.log('LOGIN STATUS: LOGGED OUT - auto-login shuru');
    await autoLogin();
  } else {
    console.log('LOGIN STATUS: logged in');
  }

  await sleep(4000);
  await closePopup();

  const getCd = () => p.evaluate(() =>
    (document.body.innerText.match(/Next session in\s*(\d+:\d+:\d+)/i) || [])[1]);

  let cd = await getCd();

  // 2) countdown nahi = session ready -> gol ball dabao
  if (!cd) {
    await sleep(rnd(30, 240) * 1000);
    await closePopup();
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
  const acc = p.getByText(/^\s*accelerate\s*$/i);
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
