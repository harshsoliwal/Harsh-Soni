import { formatInr } from './pricing';
import type { InvoiceDoc, PurityDocumentDoc } from '../types/bullion';

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadGstInvoiceHtml(invoice: InvoiceDoc) {
  const issuedDate = invoice.issuedAt?.toDate
    ? invoice.issuedAt.toDate().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Tax Invoice ${invoice.invoiceNumber} — BullionBridge Jaipur</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #141413; max-width: 820px; margin: 40px auto; padding: 32px; border: 1px solid #d9d6ce; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #141413; padding-bottom: 20px; margin-bottom: 24px; }
  .brand { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .sub { font-size: 12px; color: #666; margin-top: 4px; }
  .meta { text-align: right; font-size: 13px; line-height: 1.6; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; font-size: 13px; }
  .box { background: #fafaf8; border: 1px solid #e5e3dd; padding: 14px 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid #e5e3dd; text-align: left; }
  th { background: #f3f1ec; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, monospace; }
  .total-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #141413; background: #fafaf8; }
  .footer { margin-top: 32px; font-size: 11px; color: #666; border-top: 1px solid #e5e3dd; padding-top: 14px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">BullionBridge</div>
      <div class="sub">Jaipur B2B Verified Bullion Sourcing &amp; Exchange Desk</div>
      <div class="sub">Tax Invoice &amp; Commission Settlement Statement</div>
    </div>
    <div class="meta">
      <div><strong>Invoice No:</strong> ${invoice.invoiceNumber}</div>
      <div><strong>Order ID:</strong> ${invoice.orderId}</div>
      <div><strong>Issued (IST):</strong> ${issuedDate}</div>
    </div>
  </div>
  <div class="grid">
    <div class="box">
      <div style="font-size:11px;color:#666;margin-bottom:4px;">BUYER / JEWELLER</div>
      <strong>${invoice.jewellerShopName}</strong>
      <div>Jaipur Jewellery Cluster, Rajasthan</div>
    </div>
    <div class="box">
      <div style="font-size:11px;color:#666;margin-bottom:4px;">VERIFIED BULLION SUPPLIER</div>
      <strong>${invoice.supplierName}</strong>
      <div>Jaipur Verified Bullion Partner</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Purity</th>
        <th class="num">Weight (g)</th>
        <th class="num">Amount (INR)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${invoice.metal} Bullion (Locked MCX Base + Supplier Premium)</td>
        <td>${invoice.purity} Fine</td>
        <td class="num">${invoice.weightGrams.toFixed(2)} g</td>
        <td class="num">${formatInr(invoice.grossBullionValueInr)}</td>
      </tr>
      <tr>
        <td>BullionBridge Platform Commission (${invoice.platformCommissionRatePct}%)</td>
        <td>Service Fee</td>
        <td class="num">—</td>
        <td class="num">${formatInr(invoice.platformCommissionInr)}</td>
      </tr>
      <tr>
        <td>GST on Bullion &amp; Facilitation (${invoice.gstRatePct}%)</td>
        <td>HSN 7108 / 7106</td>
        <td class="num">—</td>
        <td class="num">${formatInr(invoice.gstAmountInr)}</td>
      </tr>
      <tr class="total-row">
        <td colspan="3">Final Payable Total (INR)</td>
        <td class="num">${formatInr(invoice.finalPayableTotalInr)}</td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    Computer-generated immutable GST Tax Invoice issued via BullionBridge Jaipur. Locked MCX price snapshot verified at supplier confirmation.
  </div>
</body>
</html>`;

  downloadTextFile(`${invoice.invoiceNumber}.html`, html, 'text/html;charset=utf-8');
}

export function downloadPuritySummary(docItem: PurityDocumentDoc) {
  if (docItem.fileUrl) {
    const a = document.createElement('a');
    a.href = docItem.fileUrl;
    a.download = docItem.fileName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  const uploadedDate = docItem.createdAt?.toDate
    ? docItem.createdAt.toDate().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const content = [
    'BULLIONBRIDGE — PURITY & ASSAYING VERIFICATION RECORD',
    '=====================================================',
    `Certificate Number : ${docItem.certificateNumber}`,
    `Order Reference    : ${docItem.orderId}`,
    `Assaying Lab / BIS : ${docItem.assayingLab}`,
    `Tested Purity      : ${docItem.testedPurity}`,
    `Gross Weight       : ${docItem.grossWeightGrams} g`,
    `Net Fine Weight    : ${docItem.netWeightGrams} g`,
    `Attached File Ref  : ${docItem.fileName}`,
    `Recorded At (IST)  : ${uploadedDate}`,
  ].join('\n');

  downloadTextFile(`${docItem.certificateNumber}_Purity_Record.txt`, content, 'text/plain;charset=utf-8');
}
