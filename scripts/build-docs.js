#!/usr/bin/env node
/**
 * Convert markdown documents to Word (.docx) for distribution.
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
    source: 'marketplace-customer-portal-technical.md',
    output: 'Market Place Customer Portal - Technical Design.docx',
    title: 'Market Place Customer Portal — Technical Design',
    subtitle: 'ServiceNow Service Portal · /customer · Version 1.0',
  },
  {
    source: 'marketplace-customer-portal-functional.md',
    output: 'Market Place Customer Portal - Functional Design.docx',
    title: 'Market Place Customer Portal — Functional Design',
    subtitle: 'Prepared for functional / UAT review · Version 1.0',
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

function stripLeadingTitle(markdown) {
  const lines = markdown.split('\n');
  let i = 0;
  if (lines[i] && lines[i].startsWith('# ')) {
    i += 1;
    while (i < lines.length && (lines[i].startsWith('**') || lines[i].trim() === '')) i += 1;
    if (lines[i] && lines[i].trim() === '---') i += 1;
    while (i < lines.length && lines[i].trim() === '') i += 1;
  }
  return lines.slice(i).join('\n');
}

function buildOne(doc) {
  const src = path.join(docsDir, doc.source);
  const out = path.join(docsDir, doc.output);
  if (!fs.existsSync(src)) throw new Error(`Missing ${src}`);

  const tmp = path.join(buildDir, `${doc.source}.stripped.md`);
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(tmp, stripLeadingTitle(fs.readFileSync(src, 'utf8')));

  execFileSync(
    'pandoc',
    [
      tmp,
      '-o',
      out,
      '--reference-doc',
      referenceDoc,
      '--metadata',
      `title=${doc.title}`,
      '--metadata',
      `subtitle=${doc.subtitle}`,
    ],
    { stdio: 'inherit' }
  );
  console.log(`Wrote ${out}`);
}

function main() {
  ensureReferenceDoc();
  for (const doc of DOCUMENTS) buildOne(doc);
}

main();
