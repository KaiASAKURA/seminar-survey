(function () {
  'use strict';

  const app = document.getElementById('app');
  const params = new URLSearchParams(window.location.search);
  let sessionId = params.get('s');
  let socket = null;
  let sessionData = null;
  const answers = {};

  // --- Init ---
  async function init() {
    // If no session ID in URL, fetch the latest session
    if (!sessionId) {
      try {
        const latestRes = await fetch('/api/sessions/latest');
        if (!latestRes.ok) {
          showError('セッションがまだ作成されていません', 'しばらくお待ちください');
          return;
        }
        const latestData = await latestRes.json();
        sessionId = latestData.id;
      } catch (e) {
        showError('接続に失敗しました', 'ページを再読み込みしてください');
        return;
      }
    }

    // Check if already answered
    try {
      if (localStorage.getItem(`survey_answered_${sessionId}`) === 'true') {
        showComplete();
        return;
      }
    } catch (e) {
      console.warn('localStorage not available:', e);
    }

    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) {
        showError('セッションが見つかりません', 'QRコードを再度読み取ってください');
        return;
      }
      sessionData = await res.json();

      // Connect socket
      socket = io();
      socket.emit('join-session', { sessionId });

      socket.on('session-status', ({ status }) => {
        sessionData.status = status;
        if (status === 'active') {
          renderQuestions();
        } else if (status === 'closed') {
          showError('回答受付は終了しました', 'ご参加ありがとうございました');
        }
      });

      if (sessionData.status === 'waiting') {
        showWaiting();
      } else if (sessionData.status === 'active') {
        renderQuestions();
      } else {
        showError('回答受付は終了しました', 'ご参加ありがとうございました');
      }
    } catch (err) {
      console.error('Init error:', err);
      showError('接続エラー', 'ネットワーク接続を確認してください');
    }
  }

  // --- Waiting Screen ---
  function showWaiting() {
    app.innerHTML = '';
    const section = document.createElement('section');
    section.className = 'waiting-screen';
    section.setAttribute('aria-label', '待機中');

    const dots = document.createElement('div');
    dots.className = 'waiting-screen__dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'waiting-screen__dot';
      dots.appendChild(dot);
    }

    const title = document.createElement('p');
    title.className = 'waiting-screen__title';
    title.textContent = 'まもなく開始します';

    const sub = document.createElement('p');
    sub.className = 'waiting-screen__sub';
    sub.textContent = 'しばらくお待ちください';

    section.appendChild(dots);
    section.appendChild(title);
    section.appendChild(sub);
    app.appendChild(section);
  }

  // --- Complete Screen ---
  function showComplete() {
    app.innerHTML = '';
    const section = document.createElement('section');
    section.className = 'complete-screen';
    section.setAttribute('aria-label', '回答完了');

    const checkWrap = document.createElement('div');
    checkWrap.className = 'complete-screen__check';
    checkWrap.innerHTML = '<svg viewBox="0 0 40 40"><path class="check-path" d="M10 20 L18 28 L30 12"/></svg>';

    const title = document.createElement('p');
    title.className = 'complete-screen__title';
    title.textContent = 'ご回答ありがとうございました';

    const sub = document.createElement('p');
    sub.className = 'complete-screen__sub';
    sub.textContent = 'スクリーンに結果が表示されます';

    section.appendChild(checkWrap);
    section.appendChild(title);
    section.appendChild(sub);
    app.appendChild(section);
  }

  // --- Error Screen ---
  function showError(titleText, subText) {
    app.innerHTML = '';
    const section = document.createElement('section');
    section.className = 'error-screen';

    const title = document.createElement('p');
    title.className = 'error-screen__title';
    title.textContent = titleText;

    const sub = document.createElement('p');
    sub.className = 'error-screen__sub';
    sub.textContent = subText;

    section.appendChild(title);
    section.appendChild(sub);
    app.appendChild(section);
  }

  // --- Render Questions ---
  function renderQuestions() {
    app.innerHTML = '';

    // Header
    const header = document.createElement('header');
    header.className = 'survey-header';
    const h1 = document.createElement('h1');
    h1.className = 'survey-header__title';
    h1.textContent = 'SEMINAR SURVEY';
    header.appendChild(h1);

    if (sessionData.name) {
      const sessionName = document.createElement('p');
      sessionName.className = 'survey-header__session';
      sessionName.textContent = sessionData.name;
      header.appendChild(sessionName);
    }

    app.appendChild(header);

    // Main
    const main = document.createElement('main');
    main.className = 'survey-main';

    const questions = sessionData.questions;
    questions.forEach((q, idx) => {
      const card = document.createElement('article');
      card.className = 'question-card';
      card.id = `card-${q.id}`;
      card.style.animationDelay = `${idx * 0.1}s`;

      const numLine = document.createElement('div');
      numLine.className = 'question-card__number';
      const qNum = `Q${idx + 1}`;
      numLine.textContent = qNum;
      if (q.type === 'multiple') {
        const hint = document.createElement('span');
        hint.className = 'question-card__type-hint';
        hint.textContent = '（複数選択可）';
        numLine.appendChild(hint);
      }

      const text = document.createElement('p');
      text.className = 'question-card__text';
      text.textContent = q.text;

      const optList = document.createElement('div');
      optList.className = 'option-list';

      q.options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.type = 'button';
        btn.setAttribute('data-qid', q.id);
        btn.setAttribute('data-value', opt);

        const label = document.createElement('span');
        label.className = 'option-btn__label';
        label.textContent = opt;
        btn.appendChild(label);

        btn.addEventListener('click', () => handleOptionClick(q, opt, btn, optList));
        optList.appendChild(btn);
      });

      card.appendChild(numLine);
      card.appendChild(text);
      card.appendChild(optList);
      main.appendChild(card);
    });

    app.appendChild(main);

    // Footer (submit)
    const footer = document.createElement('footer');
    footer.className = 'survey-footer';
    const submitBtn = document.createElement('button');
    submitBtn.className = 'submit-btn';
    submitBtn.type = 'button';
    submitBtn.id = 'submit-btn';
    const submitText = document.createElement('span');
    submitText.className = 'submit-btn__text';
    submitText.textContent = '回答を送信する';
    submitBtn.appendChild(submitText);
    submitBtn.addEventListener('click', handleSubmit);
    footer.appendChild(submitBtn);
    app.appendChild(footer);
  }

  // --- Option Click Handler ---
  function handleOptionClick(question, value, btn, optList) {
    const exclusiveOptions = ['使っていない', '分からない'];
    const allBtns = optList.querySelectorAll('.option-btn');

    // Remove error state
    const card = document.getElementById(`card-${question.id}`);
    if (card) card.classList.remove('error');

    if (question.type === 'single') {
      allBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      answers[question.id] = value;
    } else {
      // Multiple
      if (!answers[question.id]) answers[question.id] = [];

      if (exclusiveOptions.includes(value)) {
        // Selecting exclusive: clear all others
        allBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        answers[question.id] = [value];
      } else {
        // Selecting non-exclusive: clear exclusive options
        allBtns.forEach(b => {
          if (exclusiveOptions.includes(b.getAttribute('data-value'))) {
            b.classList.remove('selected');
          }
        });
        answers[question.id] = answers[question.id].filter(a => !exclusiveOptions.includes(a));

        if (btn.classList.contains('selected')) {
          btn.classList.remove('selected');
          answers[question.id] = answers[question.id].filter(a => a !== value);
        } else {
          btn.classList.add('selected');
          answers[question.id].push(value);
        }
      }

      // Clean up empty
      if (answers[question.id].length === 0) {
        delete answers[question.id];
      }
    }
  }

  // --- Submit ---
  async function handleSubmit() {
    const questions = sessionData.questions;

    // Clear previous errors
    document.querySelectorAll('.question-card.error').forEach(c => c.classList.remove('error'));

    // Validate
    let firstError = null;
    for (const q of questions) {
      if (!answers[q.id] || (Array.isArray(answers[q.id]) && answers[q.id].length === 0)) {
        const card = document.getElementById(`card-${q.id}`);
        if (card) {
          card.classList.add('error');
          if (!firstError) firstError = card;
        }
      }
    }

    if (firstError) {
      firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
      const res = await fetch(`/api/sessions/${sessionId}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '送信に失敗しました');
      }

      try {
        localStorage.setItem(`survey_answered_${sessionId}`, 'true');
      } catch (e) {
        console.warn('localStorage not available:', e);
      }
      console.log('Survey submitted successfully');
      showComplete();
    } catch (err) {
      console.error('Submit error:', err);
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      alert(err.message || '送信に失敗しました。もう一度お試しください。');
    }
  }

  // --- Start ---
  init();
})();
