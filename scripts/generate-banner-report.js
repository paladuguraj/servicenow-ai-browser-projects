const fs = require('fs');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const data = require('/tmp/test-banner-report.json');

const EXCLUDE_ACCOUNTS = ['tututut33333555', 'jkjkjkjkjj', 'Tester', 'Testering'];

const withBanner = data.withBanner
  .filter((a) => !EXCLUDE_ACCOUNTS.includes(a.name))
  .map((a) => ({
  Account: a.name,
  'File Type': a.content_type,
  'File Size (bytes)': parseInt(a.size_bytes, 10),
  'Dimensions / Description': a.file_type_description,
  'Attachment SysID': a.banner_attachment,
  'Has Banner': 'Yes',
}));

const withoutBanner = data.withoutBanner
  .filter((a) => !EXCLUDE_ACCOUNTS.includes(a.name))
  .map((a) => ({
  Account: a.name,
  'File Type': '',
  'File Size (bytes)': '',
  'Dimensions / Description': '',
  'Attachment SysID': a.sys_id,
  'Has Banner': 'No',
}));

const allRows = [...withBanner, ...withoutBanner];

// Excel
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(allRows);
XLSX.utils.book_append_sheet(wb, ws, 'White-Label Partner Banners');
XLSX.writeFile(wb, '/workspace/reports/white-label-partner-banners.xlsx');
console.log('Created /workspace/reports/white-label-partner-banners.xlsx');

// PDF
const doc = new PDFDocument({ layout: 'landscape', margin: 30 });
doc.pipe(fs.createWriteStream('/workspace/reports/white-label-partner-banners.pdf'));

const colWidths = [130, 70, 80, 280, 140, 60];
const colPositions = [30];
for (let i = 0; i < colWidths.length - 1; i++) colPositions.push(colPositions[i] + colWidths[i]);
const tableLeft = 30;
const tableRight = colPositions[colPositions.length - 1] + colWidths[colWidths.length - 1];
const rowHeight = 20;
const headerHeight = 22;
const pageBottom = 550;

function drawHeader(y) {
  doc.rect(tableLeft, y, tableRight - tableLeft, headerHeight).fill('#0b5cab');
  doc.fillColor('#ffffff');
  const headers = ['Account', 'File Type', 'File Size', 'Dimensions / Description', 'Attachment SysID', 'Has Banner'];
  headers.forEach((h, i) => {
    doc.fontSize(9).text(h, colPositions[i] + 4, y + 5, { width: colWidths[i] - 8 });
  });
}

function drawRow(row, idx, y) {
  if (idx % 2 === 0) {
    doc.rect(tableLeft, y, tableRight - tableLeft, rowHeight).fill('#f5f5f5');
  }
  doc.fillColor('#000000');
  row.forEach((cell, i) => {
    doc.fontSize(7).text(String(cell), colPositions[i] + 4, y + 5, {
      width: colWidths[i] - 8,
      height: rowHeight - 6,
      ellipsis: true,
    });
  });
}

let pageIndex = 0;
let y = 80;

doc.fontSize(16).text('White-Label Partner Banner Image Report', tableLeft, 30);
doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, tableLeft, 52);
doc.fontSize(10).text(
  `Summary: ${withBanner.length} accounts with banner images, ${withoutBanner.length} accounts without banner images.`,
  tableLeft,
  68
);

drawHeader(y);
y += headerHeight;

const rows = allRows.map((r) => [
  r.Account,
  r['File Type'],
  r['File Size (bytes)'].toString(),
  r['Dimensions / Description'],
  r['Attachment SysID'],
  r['Has Banner'],
]);

rows.forEach((row, idx) => {
  if (y > pageBottom) {
    doc.addPage({ layout: 'landscape', margin: 30 });
    pageIndex++;
    y = 40;
    drawHeader(y);
    y += headerHeight;
  }
  drawRow(row, idx, y);
  y += rowHeight;
});

doc.end();
console.log('Created /workspace/reports/white-label-partner-banners.pdf');
