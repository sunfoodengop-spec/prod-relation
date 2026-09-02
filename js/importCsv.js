import { openModal, closeModal, toast, escapeHtml as esc } from './ui.js';

export function downloadBlankCsv(filename, headers, prefillRows = []) {
  const lines = [headers.join('\t'), ...prefillRows.map(r => r.join('\t'))];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// แปลงข้อความที่วางมา (คัดลอกจาก Excel/Sheet, คั่นด้วย Tab) เป็นแถวข้อมูล
// ข้ามแถวหัวตารางให้อัตโนมัติถ้าตรวจพบว่าตรงกับ headers ที่กำหนด
export function parsePastedRows(text, headers) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const firstCells = lines[0].split('\t').map(c => c.trim());
  const looksLikeHeader = headers.some(h => firstCells.includes(h));
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;
  return dataLines.map(l => l.split('\t').map(c => c.trim()));
}

// เปิด Modal นำเข้าข้อมูลแบบทั่วไป: ปุ่มโหลดฟอร์มเปล่า + ช่องวางข้อมูล + ปุ่มนำเข้า
// onImport(rows) ต้อง return { created, updated, skipped, errors: string[] }
export function openImportModal({ title, headers, hint, blankFilename, prefillRows, onImport }) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">📥 นำเข้าจาก Excel / Google Sheet — ${esc(title)}</h3>
    ${hint ? `<p class="text-muted" style="font-size:13px;margin-top:-6px">${hint}</p>` : ''}
    <div class="flex gap-8 mb-16">
      <button class="btn btn-sm" id="download-blank-btn">📄 โหลดฟอร์มเปล่า (.csv)</button>
      <span class="text-dim" style="font-size:12px;align-self:center">คอลัมน์: ${headers.map(esc).join(' | ')}</span>
    </div>
    <div class="field">
      <label>วางข้อมูลที่คัดลอกจาก Excel/Sheet ตรงนี้ (คัดลอกทั้งแถวหัวตารางมาด้วยก็ได้ ระบบข้ามให้อัตโนมัติ)</label>
      <textarea id="paste-area" rows="10" style="font-family:var(--font-mono);font-size:12.5px" placeholder="วาง (Ctrl+V / Cmd+V) ตรงนี้..."></textarea>
    </div>
    <div id="import-result"></div>
    <div class="flex gap-8 mt-16" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="import-btn">นำเข้าข้อมูล</button>
    </div>
  `);
  backdrop.querySelector('.modal').style.width = '620px';

  backdrop.querySelector('#download-blank-btn').onclick = () => downloadBlankCsv(blankFilename, headers, prefillRows || []);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#import-btn').onclick = async () => {
    const btn = backdrop.querySelector('#import-btn');
    const text = backdrop.querySelector('#paste-area').value;
    const rows = parsePastedRows(text, headers);
    if (!rows.length) { toast('ไม่พบข้อมูลที่วาง', 'error'); return; }

    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังนำเข้า...';
    try {
      const result = await onImport(rows);
      backdrop.querySelector('#import-result').innerHTML = `
        <div class="hint-box">
          ✅ สร้างใหม่ ${result.created} รายการ · อัปเดต ${result.updated} รายการ
          ${result.skipped ? ` · ข้าม ${result.skipped} รายการ` : ''}
          ${result.errors?.length ? `<div class="text-dim mt-8">${result.errors.map(esc).join('<br>')}</div>` : ''}
        </div>`;
      toast('นำเข้าข้อมูลเรียบร้อย');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'นำเข้าข้อมูล';
    }
  };
}
