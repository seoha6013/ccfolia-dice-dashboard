(function () {
  'use strict';
  const { parseLog, attachContext, GRADES } = window.CCParser;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ALL = '__all';
  const GRADE_ORDER = ['crit', 'extreme', 'hard', 'regular', 'fail', 'fumble'];
  const GRADE_LABEL = Object.fromEntries(GRADES.map(g => [g.key, g.label]));
  const PALETTE = ['#E07AA8', '#6C8CD5', '#5DB89A', '#E5A552', '#9B7FD6', '#D9776B', '#4FA9C2', '#B58A5C'];

  const state = { files: [], entries: [], rolls: [], chars: [], color: {}, char: ALL, tab: ALL };
  const charts = {};

  /* ---------- 파일 읽기 ---------- */
  const drop = $('#drop'), input = $('#fileInput'), msg = $('#msg');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  $('#sampleBtn').addEventListener('click', loadSample);
  $('#resetBtn').addEventListener('click', () => { state.files = []; rebuild(); msg.textContent = ''; });

  async function addFiles(list) {
    const files = [...list].filter(f => /\.html?$/i.test(f.name) || f.type === 'text/html');
    if (!files.length) { msg.textContent = '.html 로그 파일만 읽을 수 있어요.'; return; }
    for (const f of files) addText(await f.text(), f.name);
    finish();
  }
  async function loadSample() {
    try {
      const res = await fetch('sample-log.html', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      addText(await res.text(), 'sample-log.html');
      finish();
    } catch (e) {
      msg.textContent = '샘플을 못 불러왔어요. 파일을 더블클릭해서 열었다면, README의 방법대로 로컬 서버로 열어 주세요.';
    }
  }
  function addText(html, name) {
    const entries = parseLog(html, name);
    state.files = state.files.filter(f => f.name !== name);       // 같은 이름은 새로 바꿔 끼움
    state.files.push({ name, entries });
  }
  function finish() {
    rebuild();
    const n = state.rolls.length;
    msg.textContent = n ? `판정 ${n}개를 찾았어요.` : '이 파일에서 1D100 판정을 찾지 못했어요. 코코포리아 로그가 맞는지 확인해 주세요.';
  }

  /* ---------- 데이터 다시 묶기 ---------- */
  function rebuild() {
    state.entries = attachContext(state.files.flatMap(f => f.entries));
    state.rolls = state.entries.filter(e => e.roll).map((e, i) => ({ ...e.roll, idx: i + 1, name: e.name, tab: e.tab, file: e.file, text: e.text }));
    const seen = new Map();
    state.entries.forEach(e => { if (e.roll && !seen.has(e.name)) seen.set(e.name, e.color); });
    state.chars = [...seen.keys()];
    const used = new Set();
    state.color = {};
    state.chars.forEach((c, i) => {
      let col = seen.get(c);
      if (!col || /^#(888|888888|000|000000|fff|ffffff)$/i.test(col) || used.has(col.toLowerCase())) col = PALETTE[i % PALETTE.length];
      used.add(col.toLowerCase()); state.color[c] = col;
    });
    if (state.char !== ALL && !state.chars.includes(state.char)) state.char = ALL;
    const tabs = [...new Set(state.rolls.map(r => r.tab))];
    if (state.tab !== ALL && !tabs.includes(state.tab)) state.tab = ALL;

    $('#fileList').innerHTML = state.files.map(f => `<li>📄 ${esc(f.name)} · ${f.entries.filter(e => e.roll).length}회</li>`).join('');
    $('#resetBtn').hidden = !state.files.length;
    $('#tabSel').innerHTML = `<option value="${ALL}">전체</option>` + tabs.map(t => `<option ${t === state.tab ? 'selected' : ''}>${esc(t)}</option>`).join('');
    $('#dash').hidden = !state.rolls.length;
    render();
  }
  $('#tabSel').addEventListener('change', e => { state.tab = e.target.value; render(); });

  /* ---------- 계산 ---------- */
  const inTab = r => state.tab === ALL || r.tab === state.tab;
  const inChar = r => state.char === ALL || r.name === state.char;
  const avg = a => a.length ? a.reduce((s, r) => s + r.value, 0) / a.length : NaN;
  const pct = (n, d) => d ? Math.round(n / d * 100) : 0;
  const isHighlight = r => r.grade === 'crit' || r.grade === 'fumble' || r.value <= 5 || r.value >= 96;
  function byChar(rolls) {
    const m = new Map(state.chars.map(c => [c, []]));
    rolls.forEach(r => m.get(r.name).push(r));
    return m;
  }
  function topSkills(rolls, n) {
    const m = new Map();
    rolls.forEach(r => { const s = m.get(r.skill) || { skill: r.skill, n: 0, ok: 0 }; s.n++; if (r.success) s.ok++; m.set(r.skill, s); });
    return [...m.values()].sort((a, b) => b.n - a.n || b.ok - a.ok).slice(0, n);
  }

  /* ---------- 그리기 ---------- */
  function render() {
    if (!state.rolls.length) { Object.values(charts).forEach(c => c.destroy()); for (const k in charts) delete charts[k]; return; }
    const tabRolls = state.rolls.filter(inTab);
    const view = tabRolls.filter(inChar);
    renderChips();
    renderStats(tabRolls, view);
    renderTable(tabRolls);
    renderGrades(view);
    renderSkills(view);
    renderFlow(tabRolls);
    renderHof(view);
  }

  function renderChips() {
    const chip = (key, label, color) =>
      `<button class="chip" role="tab" aria-selected="${state.char === key}" data-c="${esc(key)}">${color ? `<i class="dot" style="background:${color}"></i>` : ''}${esc(label)}</button>`;
    $('#charChips').innerHTML = chip(ALL, '전체 비교') + state.chars.map(c => chip(c, c, state.color[c])).join('');
  }
  $('#charChips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.char = b.dataset.c; render();
  });

  function renderStats(tabRolls, view) {
    $('#sTotal').textContent = view.length;
    $('#sAvg').textContent = view.length ? avg(view).toFixed(1) : '–';
    const groups = [...byChar(tabRolls)].filter(([, a]) => a.length);
    const min = Math.min(3, Math.max(...groups.map(([, a]) => a.length)));
    const lucky = groups.filter(([, a]) => a.length >= min).sort((x, y) => avg(x[1]) - avg(y[1]))[0];
    $('#sLucky').textContent = lucky ? lucky[0] : '–';
    $('#sLucky').style.color = lucky ? state.color[lucky[0]] : '';
    $('#sLuckySub').textContent = lucky ? `평균 ${avg(lucky[1]).toFixed(1)} · ${lucky[1].length}회` : '';
    const top = topSkills(view, 1)[0];
    $('#sSkill').textContent = top ? top.skill : '–';
    $('#sSkillSub').textContent = top ? `${top.n}회 · 성공률 ${pct(top.ok, top.n)}%` : '';
  }

  function renderTable(tabRolls) {
    const rows = [...byChar(tabRolls)].filter(([, a]) => a.length).map(([c, a]) => {
      const ok = a.filter(r => r.success).length;
      const rate = pct(ok, a.length);
      return `<tr class="${state.char === c ? 'is-on' : ''}">
        <td><span class="who"><i class="dot" style="background:${state.color[c]}"></i>${esc(c)}</span></td>
        <td>${a.length}</td><td>${avg(a).toFixed(1)}</td>
        <td>${rate}%<span class="bar"><i style="width:${rate}%"></i></span></td>
        <td>${a.filter(r => r.grade === 'crit').length}</td><td>${a.filter(r => r.grade === 'fumble').length}</td></tr>`;
    });
    $('#cmpTable tbody').innerHTML = rows.join('');
    $('#cmpNote').textContent = state.tab === ALL ? '모든 탭' : `[${state.tab}] 탭`;
  }

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function themeChart() {
    if (!window.Chart) return false;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--line');
    return true;
  }
  function put(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
  }

  function renderGrades(view) {
    if (!themeChart()) return;
    const counts = GRADE_ORDER.map(k => view.filter(r => r.grade === k).length);
    $('#gradeNote').textContent = state.char === ALL ? '전체 캐릭터' : state.char;
    put('gradeChart', {
      type: 'doughnut',
      data: { labels: GRADE_ORDER.map(k => GRADE_LABEL[k]), datasets: [{ data: counts, backgroundColor: GRADE_ORDER.map(k => css('--' + k)), borderColor: css('--card'), borderWidth: 3, hoverOffset: 6 }] },
      options: {
        maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 12,
            generateLabels: ch => ch.data.labels.map((l, i) => ({ text: `${l}  ${counts[i]}회 · ${pct(counts[i], view.length)}%`, fillStyle: ch.data.datasets[0].backgroundColor[i], strokeStyle: 'transparent', fontColor: css('--ink'), index: i, hidden: !ch.getDataVisibility(i) })) } },
          tooltip: { callbacks: { label: c => ` ${c.label} ${c.raw}회 (${pct(c.raw, view.length)}%)` } },
        },
      },
    });
    const narrow = matchMedia('(max-width:520px)').matches;
    charts.gradeChart.options.plugins.legend.position = narrow ? 'bottom' : 'right';
    charts.gradeChart.update();
  }

  function renderSkills(view) {
    if (!themeChart()) return;
    const top = topSkills(view, 5);
    put('skillChart', {
      type: 'bar',
      data: {
        labels: top.map(s => `${s.skill} (${s.n}회)`),
        datasets: [{ label: '성공률', data: top.map(s => pct(s.ok, s.n)), backgroundColor: css('--accent'), borderRadius: 8, barThickness: 22 }],
      },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        scales: { x: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: css('--line') } }, y: { grid: { display: false }, ticks: { color: css('--ink'), font: { weight: 600 } } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` 성공 ${top[c.dataIndex].ok}/${top[c.dataIndex].n} · ${c.raw}%` } } },
      },
    });
  }

  function renderFlow(tabRolls) {
    if (!themeChart()) return;
    const names = state.char === ALL ? state.chars : [state.char];
    const sets = names.map(c => {
      const pts = tabRolls.filter(r => r.name === c);
      return {
        label: c, data: pts.map(r => ({ x: r.idx, y: r.value, r })),
        borderColor: state.color[c], backgroundColor: state.color[c], tension: .3, borderWidth: 2,
        pointRadius: pts.map(r => isHighlight(r) ? 6 : 3), pointHoverRadius: 7,
        pointBackgroundColor: pts.map(r => r.grade === 'crit' || r.value <= 5 ? css('--crit') : r.grade === 'fumble' || r.value >= 96 ? css('--fumble') : state.color[c]),
        pointBorderColor: css('--card'), pointBorderWidth: 1.5,
      };
    }).filter(d => d.data.length);
    put('flowChart', {
      type: 'line', data: { datasets: sets },
      options: {
        maintainAspectRatio: false, parsing: false, interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', title: { display: true, text: '판정 순서' }, ticks: { precision: 0 }, grid: { display: false } },
          y: { min: 0, max: 100, ticks: { stepSize: 25 }, grid: { color: css('--line') } },
        },
        plugins: {
          legend: { display: sets.length > 1, labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, color: css('--ink') } },
          tooltip: { callbacks: { title: i => `#${i[0].raw.x} · ${i[0].dataset.label}`, label: c => ` ${c.raw.r.skill}: ${c.raw.y}/${c.raw.r.target} ${c.raw.r.gradeLabel}` } },
        },
      },
    });
  }

  function renderHof(view) {
    const list = view.filter(isHighlight);
    if (!list.length) { $('#hof').innerHTML = '<p class="empty">아직 결정적 순간이 없어요.</p>'; return; }
    $('#hof').innerHTML = list.map((r, i) => {
      const good = r.grade === 'crit' || (r.grade !== 'fumble' && r.value <= 5);
      const line = (o, roll) => `<div class="line${roll ? ' line--roll' : ''}"><b style="color:${state.color[o.name] || 'var(--muted)'}">${esc(o.name)}</b><span>${esc(o.text)}</span></div>`;
      return `<article class="moment ${good ? 'moment--good' : 'moment--bad'}" data-i="${i}">
        <div class="moment__top">
          <div class="moment__num">${r.value}</div>
          <div class="moment__meta"><b>${esc(r.name)}</b><span>${esc(r.skill)} · 목표 ${r.target}</span></div>
          <span class="badge">${good ? '✨' : '💥'} ${esc(r.gradeLabel)}</span>
        </div>
        <div class="moment__log">
          ${r.before.map(o => line(o)).join('')}
          ${line({ name: r.name, text: r.text }, true)}
          ${r.after.map(o => line(o)).join('')}
          <div class="moment__src">[${esc(r.tab)}] ${esc(r.file)} · #${r.idx}</div>
        </div>
        <div class="moment__act">
          <button class="btn btn--ghost btn--sm" data-act="img">이미지 저장</button>
          <button class="btn btn--ghost btn--sm" data-act="copy">텍스트 복사</button>
        </div>
      </article>`;
    }).join('');
    $('#hof')._list = list;
  }

  $('#hof').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.moment'); const r = $('#hof')._list[+card.dataset.i];
    if (b.dataset.act === 'copy') {
      const t = [
        `🎲 ${r.name} · ${r.skill} ${r.value}/${r.target} ${r.gradeLabel}`,
        ...r.before.map(o => `${o.name}: ${o.text}`),
        `${r.name}: ${r.text}`,
        ...r.after.map(o => `${o.name}: ${o.text}`),
      ].join('\n');
      try { await navigator.clipboard.writeText(t); toast('복사했어요'); }
      catch { toast('복사가 막혔어요. 브라우저 권한을 확인해 주세요'); }
    } else {
      if (!window.html2canvas) { toast('이미지 도구를 아직 불러오는 중이에요'); return; }
      const canvas = await html2canvas(card, { backgroundColor: css('--card'), scale: 2, ignoreElements: el => el.classList && el.classList.contains('moment__act') });
      const a = document.createElement('a');
      a.download = `명장면_${r.name}_${r.skill}_${r.value}.png`.replace(/[\\/:*?"<>|\s]+/g, '_');
      a.href = canvas.toDataURL('image/png'); a.click();
      toast('이미지를 저장했어요');
    }
  });

  let tt;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('is-on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('is-on'), 1800); }

  /* ---------- 테마 ---------- */
  const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('dice-theme', next); } catch {}
    render();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!document.documentElement.dataset.theme) render(); });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => state.rolls.length && renderGrades(state.rolls.filter(inTab).filter(inChar)), 200); });

  if (/[?&]sample\b/.test(location.search)) loadSample();
})();
