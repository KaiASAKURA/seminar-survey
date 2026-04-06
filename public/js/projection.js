(function () {
  'use strict';

  const waitingScreen = document.getElementById('waiting-screen');
  const resultsScreen = document.getElementById('results-screen');
  const params = new URLSearchParams(window.location.search);
  let sessionId = params.get('s');

  let socket = null;
  let sessionData = null;
  let charts = {};
  let currentCount = 0;
  let displayedCount = 0;

  const CHART_COLORS = ['#00D4AA', '#6C5CE7', '#3B82F6', '#F59E0B', '#EF4444', '#EC4899'];

  // --- Init ---
  async function init() {
    // If no session ID in URL, fetch the latest session
    if (!sessionId) {
      try {
        const latestRes = await fetch('/api/sessions/latest');
        if (!latestRes.ok) {
          waitingScreen.innerHTML = '<p style="color: rgba(255,255,255,0.7); font-size:1.2rem;">セッションがまだ作成されていません</p>';
          return;
        }
        const latestData = await latestRes.json();
        sessionId = latestData.id;
      } catch (e) {
        waitingScreen.innerHTML = '<p style="color: rgba(255,255,255,0.7); font-size:1.2rem;">接続に失敗しました</p>';
        return;
      }
    }

    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) {
        waitingScreen.innerHTML = '<p style="color: rgba(255,255,255,0.7); font-size:1.2rem;">セッションが見つかりません</p>';
        return;
      }
      sessionData = await res.json();

      const qrRes = await fetch(`/api/sessions/${sessionId}/qrcode`);
      const qrData = await qrRes.json();
      sessionData.qrCodeDataUrl = qrData.qrCodeDataUrl;

      setupSocket();
      renderWaitingScreen();
      renderResultsScreen();

      if (sessionData.status === 'active' || sessionData.status === 'closed') {
        showResults();
        loadResults();
      }
    } catch (err) {
      console.error('Projection init error:', err);
    }
  }

  // --- Socket ---
  function setupSocket() {
    socket = io();
    socket.emit('join-session', { sessionId });

    socket.on('new-response', (data) => {
      console.log('[Projection] new-response', data.responseCount);
      animateCount(data.responseCount);
      updateCharts(data.results);
    });

    socket.on('session-status', ({ status }) => {
      console.log('[Projection] session-status:', status);
      sessionData.status = status;
      if (status === 'active' || status === 'closed') {
        showResults();
        loadResults();
      } else if (status === 'waiting') {
        showWaiting();
      }
    });

    socket.on('session-reset', () => {
      console.log('[Projection] session-reset');
      currentCount = 0;
      displayedCount = 0;
      updateCountDisplay(0);
      clearCharts();
      showWaiting();
    });
  }

  // --- Waiting Screen ---
  function renderWaitingScreen() {
    waitingScreen.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'glass-card proj-waiting__card';

    const qrContainer = document.createElement('div');
    qrContainer.className = 'proj-waiting__qr';
    const qrImg = document.createElement('img');
    qrImg.src = sessionData.qrCodeDataUrl;
    qrImg.alt = 'QRコード';
    qrContainer.appendChild(qrImg);

    const url = document.createElement('p');
    url.className = 'proj-waiting__url';
    url.textContent = sessionData.participantUrl;

    const text = document.createElement('p');
    text.className = 'proj-waiting__text';
    text.textContent = 'スマートフォンでQRコードを読み取ってください';

    card.appendChild(qrContainer);
    card.appendChild(url);
    card.appendChild(text);
    waitingScreen.appendChild(card);
  }

  // --- Results Screen ---
  function renderResultsScreen() {
    resultsScreen.innerHTML = '';

    // Topbar
    const topbar = document.createElement('div');
    topbar.className = 'proj-topbar';

    const left = document.createElement('div');
    left.className = 'proj-topbar__left';

    const qrSmall = document.createElement('div');
    qrSmall.className = 'proj-topbar__qr';
    const qrImg = document.createElement('img');
    qrImg.src = sessionData.qrCodeDataUrl;
    qrImg.alt = 'QRコード';
    qrSmall.appendChild(qrImg);

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'proj-topbar__title';
    title.textContent = 'SURVEY RESULTS';
    const sessionName = document.createElement('div');
    sessionName.className = 'proj-topbar__session';
    sessionName.textContent = sessionData.name;
    info.appendChild(title);
    info.appendChild(sessionName);

    left.appendChild(qrSmall);
    left.appendChild(info);

    const right = document.createElement('div');
    right.className = 'proj-topbar__right';
    const count = document.createElement('div');
    count.className = 'proj-topbar__count';
    count.id = 'proj-count';
    count.textContent = '0';
    const countLabel = document.createElement('div');
    countLabel.className = 'proj-topbar__count-label';
    countLabel.textContent = '回答数';
    right.appendChild(count);
    right.appendChild(countLabel);

    topbar.appendChild(left);
    topbar.appendChild(right);
    resultsScreen.appendChild(topbar);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'proj-grid';

    if (sessionData.questions) {
      sessionData.questions.forEach((q, idx) => {
        const item = document.createElement('div');
        item.className = 'proj-grid__item';

        const card = document.createElement('div');
        card.className = 'glass-card proj-chart-card';

        const num = document.createElement('div');
        num.className = 'proj-chart-card__number';
        num.textContent = `Q${idx + 1}`;

        const titleEl = document.createElement('div');
        titleEl.className = 'proj-chart-card__title';
        titleEl.textContent = q.text;

        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'proj-chart-card__canvas-wrapper';

        const canvas = document.createElement('canvas');
        canvas.id = `proj-chart-${q.id}`;

        canvasWrap.appendChild(canvas);
        card.appendChild(num);
        card.appendChild(titleEl);
        card.appendChild(canvasWrap);
        item.appendChild(card);
        grid.appendChild(item);
      });
    }

    resultsScreen.appendChild(grid);
    initCharts();
  }

  // --- Charts ---
  function initCharts() {
    if (!sessionData.questions) return;

    // Destroy existing chart instances to avoid memory leaks on re-render
    Object.values(charts).forEach(c => c.destroy());
    charts = {};

    // Data label plugin
    const dataLabelPlugin = {
      id: 'projDataLabels',
      afterDraw(chart) {
        const ctx = chart.ctx;
        chart.data.datasets.forEach((dataset, i) => {
          const meta = chart.getDatasetMeta(i);
          meta.data.forEach((bar, index) => {
            const value = dataset.data[index];
            if (value > 0) {
              ctx.save();
              ctx.fillStyle = '#FFFFFF';
              ctx.font = '600 13px Inter';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              const x = bar.x + 8;
              const y = bar.y;
              ctx.fillText(value, x, y);
              ctx.restore();
            }
          });
        });
      }
    };

    sessionData.questions.forEach((q) => {
      const ctx = document.getElementById(`proj-chart-${q.id}`);
      if (!ctx) return;

      const colors = q.options.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

      charts[q.id] = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: q.options,
          datasets: [{
            data: new Array(q.options.length).fill(0),
            backgroundColor: colors,
            borderRadius: 8,
            barThickness: 28
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 800,
            easing: 'easeOutQuart'
          },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: {
                color: 'rgba(255, 255, 255, 0.08)'
              },
              ticks: {
                color: 'rgba(255, 255, 255, 0.85)',
                font: { family: 'Inter', size: 13 },
                stepSize: 1
              }
            },
            y: {
              grid: { display: false },
              ticks: {
                color: 'rgba(255, 255, 255, 0.85)',
                font: {
                  family: 'Noto Sans JP',
                  size: 13
                }
              }
            }
          }
        },
        plugins: [dataLabelPlugin]
      });
    });
  }

  function updateCharts(results) {
    if (!results || !sessionData.questions) return;

    sessionData.questions.forEach((q) => {
      const chart = charts[q.id];
      if (!chart) return;
      chart.data.datasets[0].data = q.options.map(opt => results[q.id]?.[opt]?.count || 0);
      chart.update();
    });
  }

  function clearCharts() {
    if (!sessionData.questions) return;
    sessionData.questions.forEach((q) => {
      const chart = charts[q.id];
      if (!chart) return;
      chart.data.datasets[0].data = new Array(q.options.length).fill(0);
      chart.update();
    });
  }

  // --- Count Animation ---
  function animateCount(target) {
    currentCount = target;
    const countEl = document.getElementById('proj-count');
    if (!countEl) return;

    // Bounce
    countEl.classList.remove('bounce');
    void countEl.offsetWidth;
    countEl.classList.add('bounce');

    // Animate number
    const start = displayedCount;
    const diff = target - start;
    if (diff === 0) return;

    const duration = 300;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + diff * eased);
      countEl.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        displayedCount = target;
      }
    }

    requestAnimationFrame(step);
  }

  function updateCountDisplay(value) {
    const countEl = document.getElementById('proj-count');
    if (countEl) countEl.textContent = value;
    displayedCount = value;
  }

  // --- Screen Transitions ---
  function showResults() {
    waitingScreen.classList.add('hidden');
    resultsScreen.classList.remove('hidden');
  }

  function showWaiting() {
    resultsScreen.classList.add('hidden');
    waitingScreen.classList.remove('hidden');
  }

  // --- Load Results ---
  async function loadResults() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/results`);
      if (!res.ok) return;
      const data = await res.json();
      currentCount = data.responseCount;
      displayedCount = data.responseCount;
      updateCountDisplay(data.responseCount);
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
