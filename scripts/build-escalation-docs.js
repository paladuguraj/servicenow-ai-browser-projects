#!/usr/bin/env node
/**
 * Build Escalation technical design as Word (.docx) and PDF.
 *
 * Requires: pandoc, python3 + weasyprint
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const docsDir = path.join(root, 'docs');
const buildDir = path.join(docsDir, 'build');
const source = path.join(docsDir, 'escalation-technical-design.md');

const DOC_TITLE = 'Escalation Process Enhancements — Technical Design';
const DOCX_NAME = 'Escalation Process Enhancements - Technical Design.docx';
const PDF_NAME = 'Escalation Process Enhancements - Technical Design.pdf';

const css = `
@page { size: Letter; margin: 0.75in; }
body {
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #1a1a1a;
}
h1 { font-size: 20pt; border-bottom: 2px solid #0b3d5c; padding-bottom: 0.25em; color: #0b3d5c; }
h2 { font-size: 14pt; color: #0b3d5c; margin-top: 1.4em; border-bottom: 1px solid #c5d4de; padding-bottom: 0.15em; }
h3, h4 { font-size: 12pt; color: #134e6f; margin-top: 1.1em; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0 1.2em; font-size: 10pt; }
th, td { border: 1px solid #b8c4ce; padding: 6px 8px; vertical-align: top; }
th { background: #e8f1f6; text-align: left; }
code, pre { font-family: "Consolas", "Menlo", monospace; font-size: 9.5pt; }
pre { background: #f4f6f8; padding: 10px 12px; border: 1px solid #d5dde3; overflow-x: auto; white-space: pre-wrap; }
hr { border: none; border-top: 1px solid #c5d4de; margin: 1.5em 0; }
blockquote { border-left: 3px solid #0b3d5c; margin-left: 0; padding-left: 1em; color: #333; }
`;

function ensurePandoc() {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error('pandoc is required. Install with: sudo apt-get install -y pandoc');
  }
}

function buildDocx() {
  const out = path.join(docsDir, DOCX_NAME);
  execFileSync(
    'pandoc',
    [
      source,
      '-o',
      out,
      '--from',
      'markdown',
      '--to',
      'docx',
      '-V',
      `title=${DOC_TITLE}`,
      '--metadata',
      `title=${DOC_TITLE}`,
    ],
    { stdio: 'inherit' },
  );
  console.log(`Wrote ${out}`);
  return out;
}

function buildPdf() {
  fs.mkdirSync(buildDir, { recursive: true });
  const htmlPath = path.join(buildDir, 'escalation-technical-design.html');
  const cssPath = path.join(buildDir, 'escalation-docs.css');
  const out = path.join(docsDir, PDF_NAME);

  fs.writeFileSync(cssPath, css);

  execFileSync(
    'pandoc',
    [
      source,
      '-o',
      htmlPath,
      '--from',
      'markdown',
      '--to',
      'html5',
      '--standalone',
      '--metadata',
      `title=${DOC_TITLE}`,
      '--css',
      cssPath,
      '-V',
      'margin-top=20',
    ],
    { stdio: 'inherit' },
  );

  // Inject CSS into HTML for weasyprint (file:// relative css can be flaky)
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('<style>')) {
    html = html.replace('</head>', `<style>${css}</style></head>`);
  } else {
    html = html.replace('</head>', `<style>${css}</style></head>`);
  }
  fs.writeFileSync(htmlPath, html);

  execFileSync(
    'python3',
    ['-c', `from weasyprint import HTML; HTML(filename=${JSON.stringify(htmlPath)}).write_pdf(${JSON.stringify(out)})`],
    { stdio: 'inherit' },
  );
  console.log(`Wrote ${out}`);
  return out;
}

function main() {
  if (!fs.existsSync(source)) throw new Error(`Missing ${source}`);
  ensurePandoc();
  buildDocx();
  buildPdf();
  console.log('\nDone.');
}

main();
