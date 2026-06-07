/**
 * Generates docs/tempo-pricing-sales-guide.pdf from docs/tempo-pricing-sales-guide.html
 * Run from repo root: node tools/gen-pricing-sales-pdf.js
 *
 * Uses Puppeteer (npx) when available; falls back to instructions for browser Print → PDF.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'docs', 'tempo-pricing-sales-guide.html');
const pdfPath = path.join(root, 'docs', 'tempo-pricing-sales-guide.pdf');
const htmlUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

function tryPuppeteer() {
  const script = `
    const puppeteer = require('puppeteer');
    (async () => {
      const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto(${JSON.stringify(htmlUrl)}, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: ${JSON.stringify(pdfPath)},
        format: 'Letter',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      await browser.close();
    })().catch((e) => { console.error(e); process.exit(1); });
  `;

  const tmpDir = path.join(root, 'tools', '.pdf-gen-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpScript = path.join(tmpDir, 'run-puppeteer.js');
  fs.writeFileSync(tmpScript, script, 'utf8');

  const install = spawnSync(
    'npm',
    ['install', 'puppeteer@23', '--no-save', '--prefix', tmpDir],
    { cwd: root, stdio: 'inherit', shell: true },
  );
  if (install.status !== 0) return false;

  const run = spawnSync('node', [tmpScript], {
    cwd: tmpDir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, NODE_PATH: path.join(tmpDir, 'node_modules') },
  });
  return run.status === 0 && fs.existsSync(pdfPath);
}

function tryEdgeHeadless() {
  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const edge = edgePaths.find((p) => fs.existsSync(p));
  if (!edge) return false;

  const run = spawnSync(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      `--print-to-pdf=${pdfPath}`,
      '--no-pdf-header-footer',
      htmlUrl,
    ],
    { stdio: 'inherit' },
  );
  return run.status === 0 && fs.existsSync(pdfPath);
}

function main() {
  if (!fs.existsSync(htmlPath)) {
    console.error('Missing HTML:', htmlPath);
    process.exit(1);
  }

  console.log('Generating PDF from', htmlPath);

  if (tryEdgeHeadless()) {
    console.log('Wrote', pdfPath, '(Edge headless)');
    return;
  }

  if (tryPuppeteer()) {
    console.log('Wrote', pdfPath, '(Puppeteer)');
    return;
  }

  console.log(`
Could not auto-generate PDF on this machine.

Manual export:
  1. Open ${htmlPath} in Chrome or Edge
  2. Print → Save as PDF
  3. Paper: Letter, Portrait
  4. Margins: None
  5. Enable "Background graphics"
  6. Save as ${pdfPath}
`);
  process.exit(1);
}

main();
