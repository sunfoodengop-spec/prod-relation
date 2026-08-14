import { api } from '../api.js';
import { MONTHS_TH } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';

export async function render(container, { user }) {
  const [analytics, goals] = await Promise.all([
    api.getIndividualAnalytics(user.user_id, CURRENT_YEAR_CE),
    api.listGoals(user.user_id, CURRENT_YEAR_CE),
  ]);

  let pendingCount = 0;
  if (user.role !== 'STAFF') {
    try { pendingCount = (await api.getPendingApprovals()).length; } catch { /* ignore */ }
  }

  const overallAchv = analytics.overall_achievement ?? null;
  const tactics = analytics.tactics_progress || [];
  const monthly = analytics.monthly || [];

  container.innerHTML = `
    <div class="grid grid-4 mb-16">
      <div class="card kpi">
        <div class="label">% Achievement ภาพรวมปีนี้</div>
        <div class="value">${overallAchv != null ? overallAchv + '%' : '—'}</div>
        <div class="sub">เฉลี่ยถ่วงน้ำหนักทุกเป้าหมาย</div>
      </div>
      <div class="card kpi">
        <div class="label">เป้าหมายทั้งหมด</div>
        <div class="value">${goals.length}</div>
        <div class="sub">ปี ${CURRENT_YEAR_CE}</div>
      </div>
      <div class="card kpi">
        <div class="label">ทีเด็ดทั้งหมด</div>
        <div class="value">${goals.reduce((s, g) => s + (g.tactics?.length || 0), 0)}</div>
        <div class="sub">ภายใต้เป้าหมายทั้งหมด</div>
      </div>
      <div class="card kpi">
        <div class="label">รอฉันอนุมัติ</div>
        <div class="value">${user.role === 'STAFF' ? '—' : pendingCount}</div>
        <div class="sub">${user.role === 'STAFF' ? 'สิทธิ์หัวหน้างานเท่านั้น' : 'รายงานจากลูกน้อง'}</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">แนวโน้มผลงานสะสม (Target vs Actual, ถ่วงน้ำหนัก)</div>
        <canvas id="trend-chart" height="220"></canvas>
      </div>
      <div class="card">
        <div class="card-title">Gauge % Achievement ภาพรวม</div>
        <canvas id="gauge-chart" height="220"></canvas>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-title">ความคืบหน้าทีเด็ดแต่ละข้อ</div>
      <div id="tactics-progress"></div>
    </div>
  `;

  const tacticsWrap = document.getElementById('tactics-progress');
  if (!tactics.length) {
    tacticsWrap.innerHTML = `<div class="empty-state"><div class="icon">🗒️</div>ยังไม่มีทีเด็ดในปีนี้</div>`;
  } else {
    tacticsWrap.innerHTML = tactics.map(t => {
      const pct = Math.min(100, Math.max(0, t.goal_achievement ?? 0));
      const color = pct >= 100 ? 'var(--green)' : pct >= 80 ? 'var(--amber)' : 'var(--red)';
      return `
        <div class="mb-16">
          <div class="flex-between mb-8">
            <div>
              <strong>${esc(t.tactic_title)}</strong>
              <div class="text-dim" style="font-size:12.5px">ภายใต้: ${esc(t.goal_title)}</div>
            </div>
            <span class="text-muted" style="font-size:13px">${t.goal_achievement != null ? t.goal_achievement + '%' : '—'}</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>`;
    }).join('');
  }

  const { default: Chart } = await import('https://cdn.jsdelivr.net/npm/chart.js@4/auto/+esm');
  Chart.defaults.color = '#8B96B8';
  Chart.defaults.font.family = 'Sarabun, sans-serif';
  Chart.defaults.borderColor = '#2B3860';

  const labels = monthly.map(m => MONTHS_TH[m.month_num - 1]);
  new Chart(document.getElementById('trend-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'เป้าหมาย', data: monthly.map(m => m.weighted_target), borderColor: '#6C8CFF', backgroundColor: 'rgba(108,140,255,.15)', tension: .3, fill: true },
        { label: 'ผลงานจริง', data: monthly.map(m => m.weighted_actual), borderColor: '#35C97A', backgroundColor: 'rgba(53,201,122,.15)', tension: .3, fill: true },
      ],
    },
    options: { plugins: { legend: { labels: { boxWidth: 10 } } }, scales: { y: { beginAtZero: true } } },
  });

  const gaugeVal = overallAchv ?? 0;
  const gaugeColor = gaugeVal >= 100 ? '#35C97A' : gaugeVal >= 80 ? '#F5B93F' : '#F0555C';
  new Chart(document.getElementById('gauge-chart'), {
    type: 'doughnut',
    data: {
      labels: ['สำเร็จ', 'คงเหลือ'],
      datasets: [{ data: [Math.min(gaugeVal, 150), Math.max(150 - Math.min(gaugeVal, 150), 0)], backgroundColor: [gaugeColor, '#1D2846'], borderWidth: 0 }],
    },
    options: {
      circumference: 180, rotation: 270, cutout: '75%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
    plugins: [{
      id: 'centerText',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.font = '700 26px Kanit, sans-serif';
        ctx.fillStyle = '#EAF0FB';
        ctx.textAlign = 'center';
        ctx.fillText(gaugeVal + '%', (chartArea.left + chartArea.right) / 2, chartArea.bottom - 6);
        ctx.restore();
      },
    }],
  });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
