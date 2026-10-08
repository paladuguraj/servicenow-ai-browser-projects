#!/usr/bin/env node
/**
 * Convert the CSAT markdown documents to Word (.docx) for distribution.
 *
 * Requires pandoc:  sudo apt-get install -y pandoc
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const docsDir = path.join(root, 'docs');
const buildDir = path.join(docsDir, 'build');
const referenceDoc = path.join(buildDir, 'reference.docx');

const DOCUMENTS = [
  {
    source: 'csat-technical-design.md',
    output: 'CSAT Survey Portal - Technical Design.docx',
    title: 'CSAT Survey Portal — Technical Design',
    subtitle: 'ServiceNow Service Portal · Version 1.0',
  },
  {
    source: 'csat-functional-and-test.md',
    output: 'CSAT Survey Portal - Functional Requirements and Test Report.docx',
    title: 'CSAT Survey Portal — Functional Requirements & Test Report',
    subtitle: 'Prepared for management review · Version 1.0',
  },
  {
    source: 'csat-migration.md',
    output: 'CSAT Survey Portal - Migration Runbook.docx',
    title: 'CSAT Survey Portal — Migration Runbook',
    subtitle: 'Deploying to another ServiceNow instance · Version 1.0',
  },
  {
    source: 'csat-email-template-plan.md',
    output: 'CSAT Survey Portal - Email Template Plan of Action.docx',
    title: 'CSAT Survey Invitation Email — Plan of Action',
    subtitle: 'Setting up the invitation template and survey link · Version 1.0',
  },
];

function ensureReferenceDoc() {
  if (fs.existsSync(referenceDoc)) return;
  fs.mkdirSync(buildDir, { recursive: true });
  const data = execFileSync('pandoc', ['--print-default-data-file', 'reference.docx'], {
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'buffer',
  });
  fs.writeFileSync(referenceDoc, data);
}

/**
 * The markdown files open with their own title block, which would be
 * duplicated by the generated cover page. Strip it and let pandoc's metadata
 * render the title consistently across all three documents.
 */
function stripLeadingTitle(markdown) {
  const lines = markdown.split('\n');
  let i = 0;
  if (lines[i] && lines[i].startsWith('# ')) {
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    while (i < lines.length && (lines[i].startsWith('**') || lines[i].trim() === '')) i++;
    if (lines[i] && /^-{3,}$/.test(lines[i].trim())) {
      i++;
      while (i < lines.length && lines[i].trim() === '') i++;
    }
  }
  return lines.slice(i).join('\n');
}

function build(doc) {
  const sourcePath = path.join(docsDir, doc.source);
  if (!fs.existsSync(sourcePath)) {
    console.log(`skipped ${doc.source} (not found)`);
    return;
  }

  const body = stripLeadingTitle(fs.readFileSync(sourcePath, 'utf8'));
  const tmp = path.join(buildDir, doc.source);
  fs.writeFileSync(tmp, body);

  const outputPath = path.join(docsDir, doc.output);
  execFileSync('pandoc', [
    tmp,
    '--from=gfm',
    '--to=docx',
    `--reference-doc=${referenceDoc}`,
    '--toc',
    '--toc-depth=2',
    '--metadata', `title=${doc.title}`,
    '--metadata', `subtitle=${doc.subtitle}`,
    '--metadata', 'author=ServiceNow Delivery',
    '--metadata', `date=${new Date().toISOString().slice(0, 10)}`,
    '--output', outputPath,
  ]);

  fs.unlinkSync(tmp);
  const kb = Math.round(fs.statSync(outputPath).size / 1024);
  console.log(`built   ${doc.output} (${kb} KB)`);
}

function main() {
  try {
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' });
  } catch (e) {
    console.error('pandoc is required: sudo apt-get install -y pandoc');
    process.exit(1);
  }

  ensureReferenceDoc();
  DOCUMENTS.forEach(build);
  console.log(`\nWord documents written to ${docsDir}`);
}

main();
