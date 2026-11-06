import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { LABELS, safeCell } from '@operaflow/shared';
import type { ReportDataset } from './report-data.service';

const label = (v: string) => LABELS[v] ?? v;
const MISSING = 'MISSING';
const AMBER = 'FFFDF1DF';

function fmtInstant(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
}

// ─────────────────────────────── Excel ───────────────────────────────

export async function renderXlsx(ds: ReportDataset, title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OPERAFlow';
  wb.created = new Date(ds.generatedAt);

  // Summary
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 34 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  s.addRow([safeCell(title)]).font = { bold: true, size: 14 };
  s.addRow([`Report day: ${ds.period.date} (${ds.period.timezone})`]);
  s.addRow([`Basis: ${ds.filters.dateField === 'checkIn' ? 'arrivals (check-in) on that day' : 'bookings made that day'}`]);
  s.addRow([`Generated: ${fmtInstant(ds.generatedAt, ds.period.timezone)}`]);
  s.addRow([]);
  const kv: [string, number][] = [
    ['Total bookings', ds.summary.total],
    ['Online', ds.summary.online],
    ['Offline', ds.summary.offline],
    ['Pending confirmation', ds.summary.pendingConfirmation],
    ['Cancelled', ds.summary.cancelled],
    ['Bookings with missing data', ds.summary.withMissingData],
  ];
  for (const [k, v] of kv) s.addRow([k, v]);
  s.addRow([]);
  const head = s.addRow(['Currency', 'Bookings', 'Selling total', 'Cost total', 'Margin total', 'Excluded from margin']);
  head.font = { bold: true };
  for (const c of ds.summary.currencies) {
    const r = s.addRow([c.currency, c.bookings, Number(c.selling), Number(c.cost), Number(c.margin), c.marginExcluded]);
    [3, 4, 5].forEach((i) => (r.getCell(i).numFmt = '#,##0.00'));
  }
  if (ds.summary.currencies.length === 0) s.addRow(['No active bookings in this period']);
  s.addRow([]);
  s.addRow(['Open reconciliation issues (all dates)']).font = { bold: true };
  const issues = Object.entries(ds.summary.openReconciliationIssues);
  if (issues.length === 0) s.addRow(['None']);
  for (const [k, v] of issues) s.addRow([k, v]);

  // Bookings
  const b = wb.addWorksheet('Bookings', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols: [string, number][] = [
    ['Booking ref', 16], ['Supplier ref', 16], ['Booked at', 18], ['Guest', 24], ['Hotel', 28], ['Destination', 18], ['Check-in', 12],
    ['Check-out', 12], ['Source', 22], ['Channel', 10], ['Supplier', 22], ['Status', 12], ['Selling', 13], ['Cost', 13], ['Currency', 9],
    ['Margin', 13], ['Payment', 14], ['Confirmation', 13], ['Confirmation no.', 16], ['Cancellation', 16], ['Assigned to', 18], ['Missing data', 30],
  ];
  b.columns = cols.map(([header, width]) => ({ header, width }));
  b.getRow(1).font = { bold: true };
  b.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  for (const r of ds.rows) {
    const row = b.addRow([
      r.internalRef, safeCell(r.externalRef ?? ''), fmtInstant(r.bookingDate, ds.period.timezone), safeCell(r.guestName), safeCell(r.hotel ?? MISSING),
      safeCell(r.destination ?? ''), r.checkIn, r.checkOut, safeCell(r.source), label(r.channel), safeCell(r.supplier ?? MISSING), label(r.status),
      r.sellingAmount === null ? MISSING : Number(r.sellingAmount), r.costAmount === null ? MISSING : Number(r.costAmount), r.currency,
      r.margin === null ? '' : Number(r.margin), label(r.paymentStatus), label(r.confirmationStatus), safeCell(r.confirmationNumber ?? ''),
      label(r.cancellationStatus), safeCell(r.assignedTo ?? 'Unassigned'), r.missing.join(', '),
    ]);
    [13, 14, 16].forEach((i) => (row.getCell(i).numFmt = '#,##0.00'));
    row.eachCell((cell) => {
      if (cell.value === MISSING) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
    });
  }

  // Warnings
  const w = wb.addWorksheet('Warnings');
  w.columns = [{ header: 'Booking ref', width: 18 }, { header: 'Warning', width: 90 }];
  w.getRow(1).font = { bold: true };
  if (ds.warnings.length === 0) w.addRow(['', 'No data-quality warnings']);
  for (const x of ds.warnings) w.addRow([x.internalRef ?? '(summary)', safeCell(x.message)]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─────────────────────────────── PDF ───────────────────────────────

/** Standard PDF fonts only cover Latin-1; characters outside it are replaced and flagged (Excel keeps exact values). */
function latin1(text: string, flag: { lossy: boolean }): string {
  // eslint-disable-next-line no-control-regex -- intentional Latin-1 range check
  const out = text.replace(/[^\x00-\xff]/g, '?');
  if (out !== text) flag.lossy = true;
  return out;
}

export function renderPdf(ds: ReportDataset, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: title, Producer: 'OPERAFlow' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const flag = { lossy: false };
    const t = (s: string) => latin1(s, flag);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font('Helvetica-Bold').fontSize(16).text(t(title));
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(`Report day ${ds.period.date} (${ds.period.timezone}) · ${ds.filters.dateField === 'checkIn' ? 'arrivals' : 'bookings made'} · generated ${fmtInstant(ds.generatedAt, ds.period.timezone)}`);
    doc.moveDown(0.8).fillColor('#000');

    const stats: [string, number][] = [
      ['Total', ds.summary.total], ['Online', ds.summary.online], ['Offline', ds.summary.offline],
      ['Pending confirmation', ds.summary.pendingConfirmation], ['Cancelled', ds.summary.cancelled], ['Missing data', ds.summary.withMissingData],
    ];
    const boxW = width / stats.length;
    const y0 = doc.y;
    stats.forEach(([k, v], i) => {
      doc.font('Helvetica').fontSize(8).fillColor('#666').text(k, left + i * boxW, y0, { width: boxW - 8 });
      doc.font('Helvetica-Bold').fontSize(15).fillColor(k === 'Missing data' && v ? '#a35a00' : '#000').text(String(v), left + i * boxW, y0 + 11, { width: boxW - 8 });
    });
    doc.fillColor('#000').y = y0 + 36;
    doc.x = left;

    if (ds.summary.currencies.length) {
      doc.font('Helvetica-Bold').fontSize(10).text('Totals by currency (active bookings, not converted)');
      doc.font('Helvetica').fontSize(9);
      for (const c of ds.summary.currencies) {
        doc.text(`${c.currency}: ${c.bookings} bookings · selling ${c.selling}${c.sellingMissing ? ` (+${c.sellingMissing} missing)` : ''} · cost ${c.cost}${c.costMissing ? ` (+${c.costMissing} missing)` : ''} · margin ${c.margin}${c.marginExcluded ? ` (${c.marginExcluded} excluded)` : ''}`);
      }
      doc.moveDown(0.6);
    }

    // Bookings table
    const columns: { h: string; w: number; v: (r: ReportDataset['rows'][number]) => string; right?: boolean }[] = [
      { h: 'Ref', w: 78, v: (r) => r.internalRef },
      { h: 'Guest', w: 100, v: (r) => r.guestName },
      { h: 'Hotel', w: 120, v: (r) => r.hotel ?? MISSING },
      { h: 'Stay', w: 92, v: (r) => `${r.checkIn.slice(5)} → ${r.checkOut.slice(5)}` },
      { h: 'Source', w: 80, v: (r) => `${label(r.channel)} · ${r.source}` },
      { h: 'Supplier', w: 80, v: (r) => r.supplier ?? MISSING },
      { h: 'Status', w: 58, v: (r) => label(r.status) },
      { h: 'Selling', w: 62, v: (r) => (r.sellingAmount ?? MISSING), right: true },
      { h: 'Cost', w: 58, v: (r) => (r.costAmount ?? MISSING), right: true },
      { h: 'Cur', w: 28, v: (r) => r.currency },
      { h: 'Conf.', w: 50, v: (r) => label(r.confirmationStatus) },
      { h: 'Owner', w: 64, v: (r) => r.assignedTo ?? '—' },
    ];
    const scale = width / columns.reduce((n, c) => n + c.w, 0);
    columns.forEach((c) => (c.w *= scale));

    const drawHeader = () => {
      let x = left;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#444');
      for (const c of columns) {
        doc.text(c.h, x + 2, y, { width: c.w - 4, align: c.right ? 'right' : 'left' });
        x += c.w;
      }
      doc.moveTo(left, y + 11).lineTo(left + width, y + 11).strokeColor('#ccc').stroke();
      doc.y = y + 14;
    };

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(`Bookings (${ds.rows.length})`, left);
    doc.moveDown(0.3);
    if (ds.rows.length === 0) doc.font('Helvetica').fontSize(9).text('No bookings in this period.');
    else drawHeader();

    for (const r of ds.rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
        doc.addPage();
        drawHeader();
      }
      let x = left;
      const y = doc.y;
      doc.font('Helvetica').fontSize(7.5);
      for (const c of columns) {
        const v = c.v(r);
        doc.fillColor(v === MISSING ? '#a35a00' : '#000').text(t(v), x + 2, y, { width: c.w - 4, height: 10, ellipsis: true, lineBreak: false, align: c.right ? 'right' : 'left' });
        x += c.w;
      }
      doc.y = y + 12;
    }

    if (ds.warnings.length) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).fillColor('#000').text(`Data-quality warnings (${ds.warnings.length})`, left);
      doc.font('Helvetica').fontSize(8).fillColor('#a35a00');
      for (const w of ds.warnings.slice(0, 200)) doc.text(t(`${w.internalRef ? `${w.internalRef}: ` : ''}${w.message}`), left);
      if (ds.warnings.length > 200) doc.text(`… ${ds.warnings.length - 200} more in the Excel export`);
    }

    if (flag.lossy) {
      doc.moveDown(0.8).font('Helvetica-Oblique').fontSize(8).fillColor('#555')
        .text('Some names contain characters the PDF font cannot display and are shown as "?". The Excel export contains the exact values.', left);
    }
    doc.end();
  });
}
