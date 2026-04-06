(function () {
  'use strict';

  const mainEl = document.getElementById('admin-main');
  const headerEl = document.getElementById('admin-header');
  let socket = null;
  let sessionData = null;
  let charts = {};
  let responseCount = 0;

  const CHART_COLORS = ['#0F4C81', '#00D4AA', '#6C5CE7', '#F59E0B', '#EF4444', '#3B82F6'];

  // --- Init ---
  async function init() {
    let savedSessionId = null;
    try {
      savedSessionId = localStorage.getItem('admin_sessionId');
    } catch (e) {
      console.warn('localStorage not available:', e);
    }

    if (savedSessionId) {
      try {
        const res = await fetch(`/api/sessions/${savedSessionId}`);
        if (res.ok) {
          sessionData = await res.json();
          try {
            const qrRes = await fetch(`/api/sessions/${savedSessionId}/qrcode`);
            if (qrRes.ok) {
              const qrData = await qrRes.json();
              sessionData.qrCodeDataUrl = qrData.qrCodeDataUrl;
            }
          } catch (qrErr) {
            console.warn('Failed to fetch QR code:', qrErr);
          }
          responseCount = sessionData.responseCount || 0;
          setupSocket();
          renderDashboard();
          loadResults();
          return;
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      }
      // Session not found on server — clear stale local storage
      try { localStorage.removeItem('admin_sessionId'); } catch (e) { /* ignore */ }
    }
    renderCreateSession();
  }

  // --- Socket Setup ---
  function setupSocket() {
    socket = io();
    socket.emit('join-session', { sessionId: sessionData.id });

    socket.on('new-response', (data) => {
      console.log('[Admin] new-response', data.responseCount);
      responseCount = data.responseCount;
      updateResponseCount();
      updateCharts(data.results);
    });

    socket.on('session-reset', () => {
      console.log('[Admin] session-reset');
      responseCount = 0;
      updateResponseCount();
      clearCharts();
    });

    socket.on('session-status', ({ status }) => {
      console.log('[Admin] session-status:', status);
      sessionData.status = status;
      updateStatusUI();
    });
  }

  // --- Create Session View ---
  function renderCreateSession() {
    mainEl.innerHTML = '';
    const section = document.createElement('section');
    section.className = 'create-session';

    const title = document.createElement('h2');
    title.className = 'create-session__title';
    title.textContent = '新しいセッションを作成';

    const form = document.createElement('div');
    form.className = 'create-session__form';

    const input = document.createElement('input');
    input.className = 'create-session__input';
    input.type = 'text';
    input.placeholder = 'セッション名を入力';
    input.id = 'session-name-input';

    const btn = document.createElement('button');
    btn.className = 'create-session__btn';
    btn.type = 'button';
    btn.textContent = 'セッションを作成';

    btn.addEventListener('click', () => createSession(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createSession(input.value);
    });

    form.appendChild(input);
    form.appendChild(btn);
    section.appendChild(title);
    section.appendChild(form);
    mainEl.appendChild(section);

    input.focus();
  }

  async function createSession(name) {
    if (!name || !name.trim()) {
      alert('セッション名を入力してください');
      return;
    }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      const data = await res.json();
      sessionData = {
        id: data.sessionId,
        name: data.name,
        status: data.status,
        qrCodeDataUrl: data.qrCodeDataUrl,
        participantUrl: data.participantUrl
      };

      // Fetch full session with questions
      const fullRes = await fetch(`/api/sessions/${data.sessionId}`);
      const fullData = await fullRes.json();
      sessionData.questions = fullData.questions;
      sessionData.participantUrl = fullData.participantUrl;

      try {
        localStorage.setItem('admin_sessionId', data.sessionId);
      } catch (e) {
        console.warn('localStorage not available:', e);
      }
      console.log('Session created:', data.sessionId);

      responseCount = 0;
      setupSocket();
      renderDashboard();
    } catch (err) {
      console.error('Create session error:', err);
      alert(err.message || 'セッション作成に失敗しました');
    }
  }

  // --- Dashboard ---
  function renderDashboard() {
    mainEl.innerHTML = '';

    const dashboard = document.createElement('div');
    dashboard.className = 'dashboard';

    // --- Sidebar ---
    const sidebar = document.createElement('aside');
    sidebar.className = 'dashboard__sidebar';

    // QR Card
    const qrCard = document.createElement('div');
    qrCard.className = 'card qr-section';

    const qrImg = document.createElement('img');
    qrImg.className = 'qr-section__image';
    qrImg.src = sessionData.qrCodeDataUrl;
    qrImg.alt = 'QRコード';
    qrImg.width = 200;
    qrImg.height = 200;

    const urlRow = document.createElement('div');
    urlRow.className = 'qr-section__url';
    const urlText = document.createElement('span');
    urlText.className = 'qr-section__url-text';
    urlText.textContent = sessionData.participantUrl;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'コピー';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(sessionData.participantUrl).then(() => {
        copyBtn.textContent = 'コピー済';
        setTimeout(() => { copyBtn.textContent = 'コピー'; }, 2000);
      });
    });

    urlRow.appendChild(urlText);
    urlRow.appendChild(copyBtn);
    qrCard.appendChild(qrImg);
    qrCard.appendChild(urlRow);
    sidebar.appendChild(qrCard);

    // Controls Card
    const controlsCard = document.createElement('div');
    controlsCard.className = 'card controls';
    controlsCard.id = 'controls';

    const startBtn = document.createElement('button');
    startBtn.className = 'control-btn control-btn--start';
    startBtn.id = 'btn-start';
    startBtn.textContent = '回答受付開始';
    startBtn.addEventListener('click', () => updateStatus('active'));

    const stopBtn = document.createElement('button');
    stopBtn.className = 'control-btn control-btn--stop';
    stopBtn.id = 'btn-stop';
    stopBtn.textContent = '回答受付終了';
    stopBtn.addEventListener('click', () => updateStatus('closed'));

    const resetBtn = document.createElement('button');
    resetBtn.className = 'control-btn control-btn--reset';
    resetBtn.id = 'btn-reset';
    resetBtn.textContent = '結果をリセット';
    resetBtn.addEventListener('click', resetResults);

    const projectionBtn = document.createElement('button');
    projectionBtn.className = 'control-btn control-btn--projection';
    projectionBtn.textContent = '投影画面を開く';
    projectionBtn.addEventListener('click', () => {
      window.open('/projection.html', '_blank');
    });

    controlsCard.appendChild(startBtn);
    controlsCard.appendChild(stopBtn);
    controlsCard.appendChild(resetBtn);
    controlsCard.appendChild(projectionBtn);
    sidebar.appendChild(controlsCard);

    // Response Count Card
    const countCard = document.createElement('div');
    countCard.className = 'card response-count';
    const countNum = document.createElement('div');
    countNum.className = 'response-count__number';
    countNum.id = 'response-count';
    countNum.textContent = responseCount;
    const countLabel = document.createElement('div');
    countLabel.className = 'response-count__label';
    countLabel.textContent = '回答数';
    countCard.appendChild(countNum);
    countCard.appendChild(countLabel);
    sidebar.appendChild(countCard);

    dashboard.appendChild(sidebar);

    // --- Content (Charts) ---
    const content = document.createElement('div');
    content.className = 'dashboard__content';
    content.id = 'charts-container';

    if (sessionData.questions) {
      sessionData.questions.forEach((q, idx) => {
        const card = document.createElement('div');
        card.className = 'card chart-card';
        card.id = `chart-card-${q.id}`;

        const num = document.createElement('div');
        num.className = 'chart-card__number';
        num.textContent = `Q${idx + 1}`;

        const title = document.createElement('div');
        title.className = 'chart-card__title';
        title.textContent = q.text;

        const empty = document.createElement('div');
        empty.className = 'chart-card__empty';
        empty.id = `chart-empty-${q.id}`;
        empty.textContent = 'まだ回答がありません';

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'chart-card__canvas-wrapper';
        canvasWrapper.id = `chart-wrapper-${q.id}`;
        canvasWrapper.style.display = 'none';

        const canvas = document.createElement('canvas');
        canvas.id = `chart-${q.id}`;

        canvasWrapper.appendChild(canvas);
        card.appendChild(num);
        card.appendChild(title);
        card.appendChild(empty);
        card.appendChild(canvasWrapper);
        content.appendChild(card);
      });
    }

    dashboard.appendChild(content);
    mainEl.appendChild(dashboard);

    // Init charts
    initCharts();
    updateStatusUI();
  }

  // --- Charts ---
  function initCharts() {
    if (!sessionData.questions) return;

    // Destroy existing chart instances to avoid memory leaks on re-render
    Object.values(charts).forEach(c => c.destroy());
    charts = {};

    sessionData.questions.forEach((q) => {
      const ctx = document.getElementById(`chart-${q.id}`);
      if (!ctx) return;

      const colors = q.options.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

      charts[q.id] = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: q.options,
          datasets: [{
            data: new Array(q.options.length).fill(0),
            backgroundColor: colors,
            borderRadius: 6,
            barThickness: 24
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 500,
            easing: 'easeOutQuart'
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.raw} 件`
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: {
                color: 'rgba(0,0,0,0.06)'
              },
              ticks: {
                stepSize: 1,
                font: { family: 'Inter' }
              }
            },
            y: {
              grid: { display: false },
              ticks: {
                font: {
                  family: 'Noto Sans JP',
                  size: 12
                }
              }
            }
          }
        }
      });

      // Set canvas wrapper height
      const wrapper = document.getElementById(`chart-wrapper-${q.id}`);
      if (wrapper) {
        wrapper.style.height = `${Math.max(q.options.length * 40, 120)}px`;
      }
    });
  }

  function updateCharts(results) {
    if (!results || !sessionData.questions) return;

    sessionData.questions.forEach((q) => {
      const chart = charts[q.id];
      if (!chart) return;

      const data = q.options.map(opt => results[q.id]?.[opt]?.count || 0);
      const hasData = data.some(v => v > 0);

      chart.data.datasets[0].data = data;
      chart.update();

      const emptyEl = document.getElementById(`chart-empty-${q.id}`);
      const wrapperEl = document.getElementById(`chart-wrapper-${q.id}`);
      if (emptyEl && wrapperEl) {
        emptyEl.style.display = hasData ? 'none' : 'block';
        wrapperEl.style.display = hasData ? 'block' : 'none';
      }
    });
  }

  function clearCharts() {
    if (!sessionData.questions) return;
    sessionData.questions.forEach((q) => {
      const chart = charts[q.id];
      if (!chart) return;
      chart.data.datasets[0].data = new Array(q.options.length).fill(0);
      chart.update();

      const emptyEl = document.getElementById(`chart-empty-${q.id}`);
      const wrapperEl = document.getElementById(`chart-wrapper-${q.id}`);
      if (emptyEl && wrapperEl) {
        emptyEl.style.display = 'block';
        wrapperEl.style.display = 'none';
      }
    });
  }

  // --- Status ---
  async function updateStatus(status) {
    try {
      const res = await fetch(`/api/sessions/${sessionData.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Status update failed');
      sessionData.status = status;
      updateStatusUI();
      console.log('Status updated:', status);
    } catch (err) {
      console.error('Status update error:', err);
      alert('ステータスの更新に失敗しました');
    }
  }

  function updateStatusUI() {
    const status = sessionData.status;

    // Header badge
    const existingBadge = headerEl.querySelector('.admin-header__badge');
    if (existingBadge) existingBadge.remove();

    const badge = document.createElement('span');
    badge.className = `admin-header__badge admin-header__badge--${status}`;
    const labels = { waiting: '待機中', active: '受付中', closed: '終了' };
    badge.textContent = labels[status] || status;
    headerEl.appendChild(badge);

    // Buttons
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    if (startBtn) startBtn.disabled = status !== 'waiting';
    if (stopBtn) stopBtn.disabled = status !== 'active';
  }

  function updateResponseCount() {
    const el = document.getElementById('response-count');
    if (el) el.textContent = responseCount;
  }

  // --- Reset ---
  async function resetResults() {
    if (!confirm('回答結果をリセットしますか？この操作は取り消せません。')) return;

    try {
      const res = await fetch(`/api/sessions/${sessionData.id}/reset`, { method: 'POST' });
      if (!res.ok) throw new Error('Reset failed');
      responseCount = 0;
      updateResponseCount();
      clearCharts();
      console.log('Results reset');
    } catch (err) {
      console.error('Reset error:', err);
      alert('リセットに失敗しました');
    }
  }

  // --- Load initial results ---
  async function loadResults() {
    try {
      const res = await fetch(`/api/sessions/${sessionData.id}/results`);
      if (!res.ok) return;
      const data = await res.json();
      responseCount = data.responseCount;
      updateResponseCount();
      if (data.responseCount > 0) {
        updateCharts(data.results);
      }
    } catch (err) {
      console.error('Load results error:', err);
    }
  }

  // --- Start ---
  init();
})();
