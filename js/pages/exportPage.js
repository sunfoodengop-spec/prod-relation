import { api } from '../api.js';
import { toast, MONTHS_TH, escapeHtml as esc } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';

export async function render(container, { user }) {
  let people = [{ user_id: user.user_id, first_name: user.first_name, last_name: user.last_name, department: user.department, position_title: user.position_title }];
  if (user.role !== 'STAFF') {
    try { people = people.concat(await api.getSubordinates()); } catch { /* ignore */ }
  }
  const departments = [...new Set(people.map(p => p.department).filter(Boolean))];

  container.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="card-title">ตัวกรองข้อมูลก่อนส่งออก</div>
      <div class="field"><label>ปีงบประมาณ</label>
        <input id="f-year" type="number" value="${CURRENT_YEAR_CE}">
      </div>
      ${departments.length ? `
        <div class="field"><label>แผนก</label>
          <select id="f-dept"><option value="">ทั้งหมด</option>${departments.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>
        </div>` : ''}
      <div class="field"><label>รายบุคคล</label>
        <select id="f-person">
          <option value="">ทั้งหมด (ตามสิทธิ์การมองเห็น)</option>
          ${people.map(p => `<option value="${p.user_id}">${esc(p.first_name)} ${esc(p.last_name)}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" id="export-btn">📥 ส่งออกเป็น Excel (.xlsx)</button>
      <div id="export-status" class="mt-16"></div>
    </div>
  `;

  document.getElementById('export-btn').onclick = () => doExport(people);
}

async function doExport(people) {
  const status = document.getElementById('export-status');
  const btn = document.getElementById('export-btn');
  const year = Number(document.getElementById('f-year').value);
  const dept = document.getElementById('f-dept')?.value || '';
  const personId = document.getElementById('f-person').value;

  let targets = people;
  if (dept) targets = targets.filter(p => p.department === dept);
  if (personId) targets = targets.filter(p => String(p.user_id) === personId);

  if (!targets.length) { toast('ไม่พบพนักงานตามเงื่อนไขที่เลือก', 'error'); return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังจัดเตรียมข้อมูล...';
  status.innerHTML = '';

  try {
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');

    const summaryRows = [];
    const detailRows = [];

    for (const p of targets) {
      const goals = await api.listGoals(p.user_id, year);
      const scoreboard = await api.getScoreboard(p.user_id, year);

      goals.forEach(g => {
        const monthly = scoreboard.filter(s => s.goal_id === g.goal_id);
        const avgAchv = monthly.filter(m => m.achievement_percentage != null);
        const overallAchv = avgAchv.length ? (avgAchv.reduce((s, m) => s + Number(m.achievement_percentage), 0) / avgAchv.length).toFixed(2) : '';

        summaryRows.push({
          'รหัสพนักงาน': p.emp_code || '', 'ชื่อ-นามสกุล': `${p.first_name} ${p.last_name}`,
          'ตำแหน่ง': p.position_title || '', 'แผนก': p.department || '',
          'เป้าหมาย': g.goal_title, 'ตัวชี้วัด': g.metric_unit || '', 'น้ำหนัก (%)': g.weight_percentage ?? '',
          '% Achievement เฉลี่ย': overallAchv,
        });

        MONTHS_TH.forEach((label, i) => {
          const m = monthly.find(x => x.month_num === i + 1);
          detailRows.push({
            'ชื่อ-นามสกุล': `${p.first_name} ${p.last_name}`, 'เป้าหมาย': g.goal_title, 'เดือน': label,
            'เป้าหมาย(ตัวเลข)': m?.target_val ?? '', 'ผลจริง': m?.actual_val ?? '',
            'ส่วนต่าง': m?.variance_val ?? '', '% สำเร็จ': m?.achievement_percentage ?? '',
            'สถานะ': m?.status_color === 'GREEN' ? 'เขียว' : m?.status_color === 'YELLOW' ? 'เหลือง' : m?.status_color === 'RED' ? 'แดง' : '',
            'สถานะอนุมัติ': m?.approval_status || '',
          });
        });
      });
    }

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    wsSummary['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'สรุปเป้าหมาย');

    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    wsDetail['!cols'] = [{ wch: 22 }, { wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'รายเดือน');

    const filename = `Goal_Scoreboard_Export_${year}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    status.innerHTML = `<div class="hint-box">✅ ส่งออกไฟล์ <strong>${filename}</strong> เรียบร้อย</div>`;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '📥 ส่งออกเป็น Excel (.xlsx)';
  }
}
