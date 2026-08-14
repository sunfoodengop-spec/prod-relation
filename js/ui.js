export const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

export const OPERATOR_SYMBOL = { GT: '>', GTE: '≥', LT: '<', LTE: '≤', EQ: '=' };
export const OPERATOR_LABEL_TH = {
  GT: 'มากกว่า (>)', GTE: 'มากกว่าหรือเท่ากับ (≥)', LT: 'น้อยกว่า (<)',
  LTE: 'น้อยกว่าหรือเท่ากับ (≤)', EQ: 'เท่ากับ (=)',
};

export function toast(message, type = 'success') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function statusPill(color) {
  const map = { GREEN: ['green', 'บรรลุเป้า'], YELLOW: ['yellow', 'ใกล้เป้า'], RED: ['red', 'ต่ำกว่าเป้า'] };
  const [cls, label] = map[color] || ['neutral', 'ยังไม่มีข้อมูล'];
  return `<span class="pill ${cls}"><span class="dot"></span>${label}</span>`;
}

export function approvalPill(status) {
  const map = {
    DRAFT: ['neutral', 'ฉบับร่าง'], SUBMITTED: ['yellow', 'รอตรวจสอบ'],
    APPROVED: ['green', 'อนุมัติแล้ว'], REJECTED: ['red', 'ส่งกลับแก้ไข'],
  };
  const [cls, label] = map[status] || ['neutral', '-'];
  return `<span class="pill ${cls}"><span class="dot"></span>${label}</span>`;
}

export function initials(firstName, lastName) {
  return `${(firstName || '?')[0]}${(lastName || '')[0] || ''}`.toUpperCase();
}

export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

export function openModal(innerHtml) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="card modal">${innerHtml}</div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  return backdrop;
}

export function closeModal(el) {
  el?.remove();
}

export async function confirmDialog(message) {
  return new Promise((resolve) => {
    const backdrop = openModal(`
      <p style="margin:0 0 18px;font-size:14.5px;">${escapeHtml(message)}</p>
      <div class="flex gap-8" style="justify-content:flex-end;">
        <button class="btn" data-act="cancel">ยกเลิก</button>
        <button class="btn btn-danger" data-act="ok">ยืนยัน</button>
      </div>
    `);
    backdrop.querySelector('[data-act="ok"]').onclick = () => { closeModal(backdrop); resolve(true); };
    backdrop.querySelector('[data-act="cancel"]').onclick = () => { closeModal(backdrop); resolve(false); };
  });
}
