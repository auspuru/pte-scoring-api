'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const BASE_URL = process.env.QA_URL || 'https://swt.up.railway.app/';
const OUT = path.resolve(process.env.QA_OUT || 'visual-qa-output');
fs.mkdirSync(OUT, { recursive: true });

const viewports = [
  { name:'desktop', width:1440, height:1000, deviceScaleFactor:1 },
  { name:'tablet', width:1024, height:900, deviceScaleFactor:1 },
  { name:'mobile', width:390, height:844, deviceScaleFactor:1 }
];

const surfaces = [
  { name:'login', login:true },
  { name:'home', route:'dashboard' },
  { name:'practice', route:'practice-hub' },
  { name:'mocks', route:'mock-tests' },
  { name:'teacher', route:'next-steps' },
  { name:'progress', route:'progress' },
  { name:'vocabulary', route:'vocab' },
  { name:'library', route:'library' }
];

const routePanes = {
  dashboard:'dashboardPane',
  'practice-hub':'practiceHubPane',
  'mock-tests':'mockTestsPane',
  'next-steps':'nextStepsPane',
  progress:'progressPane',
  vocab:'vocabScreen',
  library:'libraryPane'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function prepareShell(page, route) {
  return page.evaluate(async ({ route, routePanes }) => {
    const errors = [];
    const login = document.getElementById('loginScreen');
    const shell = document.getElementById('appShell');
    if (login) {
      login.classList.remove('active');
      login.style.setProperty('display','none','important');
    }
    if (shell) {
      shell.classList.remove('u-inline-005');
      shell.style.setProperty('display','grid','important');
    }
    const name = document.getElementById('userName');
    const avatar = document.getElementById('userAvatar');
    if (name) name.textContent = 'Visual QA';
    if (avatar) avatar.textContent = 'Q';

    try {
      if (typeof window.initialisePortalWorkspace === 'function') window.initialisePortalWorkspace();
      if (typeof window.switchSection === 'function') {
        window.switchSection(route);
      }
    } catch (error) {
      errors.push(String(error && error.message || error));
    }

    await new Promise(resolve => setTimeout(resolve, 700));

    const expected = routePanes[route];
    const pane = expected && document.getElementById(expected);
    if (pane && pane.hidden) {
      document.querySelectorAll('.panes-container .pane').forEach(node => {
        node.hidden = node.id !== expected;
        node.classList.toggle('active', node.id === expected);
        node.classList.toggle('show', node.id === expected);
      });
    }
    document.body.dataset.section = route;

    if (expected === 'libraryPane') {
      const library = document.getElementById('libraryPane');
      if (library) {
        library.classList.remove('u-inline-005');
        library.style.removeProperty('display');
      }
    }
    if (expected === 'vocabScreen') {
      const vocab = document.getElementById('vocabScreen');
      if (vocab) {
        vocab.classList.remove('u-inline-005');
        vocab.style.removeProperty('display');
      }
    }

    return {
      errors,
      expected,
      paneExists: !!pane,
      paneHidden: pane ? pane.hidden : null,
      title: document.title,
      section: document.body.dataset.section || ''
    };
  }, { route, routePanes });
}

async function auditViewport(page, surface) {
  return page.evaluate(surface => {
    const visible = el => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const interactive = [...document.querySelectorAll('button,a,input,select,textarea,[tabindex]')]
      .filter(visible)
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || '',
          cls: String(el.className || '').slice(0,90),
          text: String(el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g,' ').slice(0,80),
          left: Math.round(r.left),
          right: Math.round(r.right),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height)
        };
      });
    const clipped = interactive.filter(x => x.right > innerWidth + 2 || x.left < -2);
    const smallTargets = interactive.filter(x => x.width < 40 || x.height < 40).slice(0,30);
    const tinyText = [...document.querySelectorAll('body *')].filter(visible).map(el => {
      const px = parseFloat(getComputedStyle(el).fontSize || '0');
      if (!(px > 0 && px < 12)) return null;
      const text = String(el.textContent || '').trim().replace(/\s+/g,' ').slice(0,80);
      if (!text) return null;
      return { tag:el.tagName,id:el.id||'',cls:String(el.className||'').slice(0,90),px,text };
    }).filter(Boolean).slice(0,40);

    return {
      surface,
      viewport:{width:innerWidth,height:innerHeight},
      scroll:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      horizontalOverflow:Math.max(0, document.documentElement.scrollWidth - innerWidth),
      clipped,
      smallTargets,
      tinyText,
      lazyStyles:[...document.querySelectorAll('link[data-ipt-lazy-style]')].map(link => ({
        key:link.dataset.iptLazyStyle,
        href:link.getAttribute('href'),
        sheetReady:!!link.sheet
      })),
      shellReady:document.body.dataset.iptShellReady || null
    };
  }, surface);
}

(async () => {
  const browser = await puppeteer.launch({
    headless:'new',
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
  });
  const report = {
    url:BASE_URL,
    generatedAt:new Date().toISOString(),
    viewports:{},
    fatal:[]
  };

  try {
    for (const vp of viewports) {
      report.viewports[vp.name] = {};
      for (const surface of surfaces) {
        const page = await browser.newPage();
        await page.setViewport(vp);
        const consoleIssues = [];
        const pageErrors = [];
        const failedRequests = [];

        page.on('console', msg => {
          if (['error','warning'].includes(msg.type())) consoleIssues.push({type:msg.type(),text:msg.text().slice(0,500)});
        });
        page.on('pageerror', error => pageErrors.push(String(error.message || error).slice(0,500)));
        page.on('requestfailed', req => {
          const failure=req.failure();
          failedRequests.push({url:req.url(),error:failure && failure.errorText || 'failed'});
        });

        let response;
        try {
          response = await page.goto(BASE_URL, { waitUntil:'domcontentloaded', timeout:45000 });
          await sleep(2500);
        } catch (error) {
          report.fatal.push({viewport:vp.name,surface:surface.name,error:String(error.message||error)});
        }

        let prep = null;
        if (!surface.login) {
          try {
            prep = await prepareShell(page, surface.route);
            await sleep(1600);
          } catch (error) {
            prep = { errors:[String(error.message||error)] };
          }
        }

        const screenshot = path.join(OUT, `${vp.name}-${surface.name}.png`);
        try {
          await page.screenshot({ path:screenshot, fullPage:false });
        } catch (error) {
          report.fatal.push({viewport:vp.name,surface:surface.name,error:'screenshot: '+String(error.message||error)});
        }

        let audit = null;
        try { audit = await auditViewport(page, surface.name); } catch (error) { audit={error:String(error.message||error)}; }

        report.viewports[vp.name][surface.name] = {
          httpStatus:response && response.status(),
          url:page.url(),
          prep,
          audit,
          consoleIssues,
          pageErrors,
          failedRequests:failedRequests.filter(x => !/favicon\.ico/.test(x.url)).slice(0,30)
        };
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(OUT,'qa-report.json'), JSON.stringify(report,null,2));
  const summary = [];
  for (const [vp,surfaces] of Object.entries(report.viewports)) {
    for (const [name,item] of Object.entries(surfaces)) {
      summary.push({
        viewport:vp,
        surface:name,
        status:item.httpStatus,
        overflow:item.audit && item.audit.horizontalOverflow,
        clipped:item.audit && item.audit.clipped ? item.audit.clipped.length : null,
        tinyText:item.audit && item.audit.tinyText ? item.audit.tinyText.length : null,
        consoleIssues:item.consoleIssues.length,
        pageErrors:item.pageErrors.length,
        failedRequests:item.failedRequests.length
      });
    }
  }
  fs.writeFileSync(path.join(OUT,'summary.json'), JSON.stringify(summary,null,2));
  console.log(JSON.stringify({fatal:report.fatal,summary},null,2));
  if (report.fatal.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
