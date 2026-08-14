import { api } from '../api.js';
import { MONTHS_TH, escapeHtml as esc } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';

let Chart;

export async function render(container, { user }) {
  let subordinates = [];
  if (user.role !== 'STAFF') {
    try { subordinates = await api.getSubordinates(); } catch { subordinates = []; }
  }

  container.innerHTML = `
    ${subordinates.length ? `
      <div class="mb-16">
        <select id="viewer-select" style="width:280px">
          <option value="${user.user_id}">🙋 ของฉันเอง (${esc(user.first_name)})</option>
          ${subordinates.map(s => `<option value="${s.user_id}">${esc(s.first_name)} ${esc(s.last_name)} — ${esc(s.position_title)}</option>`).join('')}
        </select>
      </div>
    ` : ''}
    <div class="grid grid-2 mb-16">
      <div class="card"><div class="card-title">กราฟแท่ง เป้าหมาย vs ผลงานจริง รายเดือน</div><canvas id="bar-chart" height="230"></canvas></div>
      <div class="card"><div class="card-title">Gauge % Achievement ภาพรวมประจำปี</div><canvas id="gauge-chart" height="230"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">ความคืบหน้าทีเด็ดแต่ละข้อ</div>
      <div id="progress-list"></div>
    </div>
  `;

  const viewerSelect = document.getElementById('viewer-select');
  const targetId = () => Number(viewerSelect ? viewerSelect.value : user.user_id);
  if (viewerSelect) viewerSelect.onchange = () => load(targetId());

  await load(targetId());
}

async function load(targetUserId) {
  const analytics = await api.getIndividualAnalytics(targetUserId, CURRENT_YEAR_CE);
  const monthly = analytics.monthly || [];
  const tactics = analytics.tactics_progress || [];
  const overallAchv = analytics.overall_achievement ?? 0;

  if (!Chart) ({ default: Chart } = await import('https://cdn.jsdelivr.net/npm/chart.js@4/auto/+esm'));
  Chart.defaults.color = '#8B96B8';
  Chart.defaults.font.family = 'Sarabun, sans-serif';
  Chart.defaults.borderColor = '#2B3860';

  const barCanvas = document.getElementById('bar-chart');
  barCanvas.replaceWith(barCanvas.cloneNode()); // reset previous chart instance
  const gaugeCanvas = document.getElementById('gauge-chart');
  gaugeCanvas.replaceWith(gaugeCanvas.cloneNode());

  new Chart(document.getElementById('bar-chart'), {
    type: 'bar',
    data: {
      labels: monthly.map(m => MONTHS_TH[m.month_num - 1]),
      datasets: [
        { label: 'เป้าหมาย', data: monthly.map(m => m.weighted_target), backgroundColor: 'rgba(108,140,255,.55)', borderRadius: 4 },
        { label: 'ผลงานจริง', data: monthly.map(m => m.weighted_actual), backgroundColor: 'rgba(53,201,122,.65)', borderRadius: 4 },
      ],
    },
    options: { plugins: { legend: { labels: { boxWidth: 10 } } }, scales: { y: { beginAtZero: true } } },
  });

  const color = overallAchv >= 100 ? '#35C97A' : overallAchv >= 80 ? '#F5B93F' : '#F0555C';
  new Chart(document.getElementById('gauge-chart'), {
    type: 'doughnut',
    data: { labels: ['สำเร็จ', 'คงเหลือ'], datasets: [{ data: [Math.min(overallAchv, 150), Math.max(150 - Math.min(overallAchv, 150), 0)], backgroundColor: [color, '#1D2846'], borderWidth: 0 }] },
    options: { circumference: 180, rotation: 270, cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } } },
    plugins: [{
      id: 'centerText',
      afterDraw(chart) {
        const { ctx: c, chartArea } = chart;
        c.save(); c.font = '700 26px Kanit, sans-serif'; c.fillStyle = '#EAF0FB'; c.textAlign = 'center';
        c.fillText(overallAchv + '%', (chartArea.left + chartArea.right) / 2, chartArea.bottom - 6);
        c.restore();
      },
    }],
  });

  const progressWrap = document.getElementById('progress-list');
  progressWrap.innerHTML = tactics.length ? tactics.map(t => {
    const pct = Math.min(100, Math.max(0, t.goal_achievement ?? 0));
    const c = pct >= 100 ? 'var(--green)' : pct >= 80 ? 'var(--amber)' : 'var(--red)';
    return `<div class="mb-16">
      <div class="flex-between mb-8"><strong>${esc(t.tactic_title)}</strong><span class="text-muted" style="font-size:13px">${t.goal_achievement != null ? t.goal_achievement + '%' : '—'}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${c}"></div></div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="icon">🗒️</div>ยังไม่มีทีเด็ดในปีนี้</div>`;
}
