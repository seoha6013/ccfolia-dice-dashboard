/* 코코포리아 로그 파서 — 브라우저 안에서만 동작 (파일은 어디로도 전송되지 않음)
 *
 * 코코포리아 내보내기 HTML 한 줄의 모양:
 *   <p style="color:#888888;">
 *     <span> [main]</span>
 *     <span>캐릭터명</span> :
 *     <span>CC<=80 사격(권총) (1D100<=80) 보너스・패널티 주사위[0] ＞ 26 ＞ 어려운 성공</span>
 *   </p>
 */
(function (global) {
  'use strict';

  /* ---------- 정규표현식 설계 ---------- */
  const RE = {
    // span 구조가 없을 때 쓰는 줄 단위 대체 패턴: "[탭] 이름 : 메시지"
    line: /^\s*\[([^\]]+)\]\s*([^:：]+?)\s*[:：]\s*([\s\S]*)$/,
    // 1D100 판정인지: "(1D100<=80)" 괄호 부분 (CC / CCB / 1D100<=n 모두 이 형태를 출력함)
    check: /\(\s*1D100\s*<=\s*(\d{1,3})\s*\)/i,
    // 맨 끝의 "＞ 26 ＞ 어려운 성공" — 마지막 숫자와 그 뒤 결과 문구
    tail: /(\d{1,3})\s*[＞>→]\s*([^＞>→]+?)\s*$/,
    // 앞쪽 명령어: "S CC(1)<=80", "CCB<=50", "1D100<=50" 등
    cmd: /^\s*S?\s*(?:CCB?|CBRB?|1D100)\s*(?:\(\s*-?\d+\s*\))?\s*<=\s*\d{1,3}\s*/i,
    // 명령어와 "(1D100" 사이 = 기능명.  "사격(권총)"처럼 괄호가 들어간 기능명도 살아남게 "(1D100"에서만 자름
    skill: /^([\s\S]*?)\s*\(\s*1D100/i,
    brackets: /[【】「」『』〈〉《》\[\]]/g,
  };

  // 결과 문구 → 등급. 순서가 중요: '대실패'는 '실패'보다, '대성공'은 '성공'보다 먼저 검사
  const GRADES = [
    { key: 'crit',    label: '대성공',      re: /대성공|결정적\s*성공|クリティカル|critical/i },
    { key: 'fumble',  label: '대실패',      re: /대실패|펌블|ファンブル|fumble/i },
    { key: 'extreme', label: '극단적 성공', re: /극단적\s*성공|익스트림|イクストリーム|extreme/i },
    { key: 'hard',    label: '어려운 성공', re: /어려운\s*성공|하드\s*성공|ハード成功|hard/i },
    { key: 'regular', label: '보통 성공',   re: /보통\s*성공|레귤러|レギュラー成功|regular|^\s*성공\s*$|^\s*成功\s*$|success/i },
    { key: 'fail',    label: '실패',        re: /실패|失敗|fail/i },
  ];
  const SUCCESS = new Set(['crit', 'extreme', 'hard', 'regular']);

  function gradeOf(text) {
    for (const g of GRADES) if (g.re.test(text)) return g;
    return null;
  }

  /* 메시지 한 줄에서 판정 정보를 꺼냄. 1D100 판정이 아니면 null */
  function parseRoll(msg) {
    const text = msg.replace(/\s+/g, ' ').trim();
    const chk = text.match(RE.check);
    if (!chk) return null;
    const tail = text.match(RE.tail);
    if (!tail) return null;
    const value = Number(tail[1]);
    const grade = gradeOf(tail[2]);
    if (!grade || value < 1 || value > 100) return null;

    let skill = '';
    const sk = text.replace(RE.cmd, '').match(RE.skill);
    if (sk) skill = sk[1].replace(RE.brackets, ' ').replace(/\s+/g, ' ').trim();
    return {
      skill: skill || '이름 없는 판정',
      target: Number(chk[1]),
      value,
      grade: grade.key,
      gradeLabel: grade.label,
      success: SUCCESS.has(grade.key),
    };
  }

  /* HTML 문자열 → 메시지 목록 */
  function parseLog(html, fileName) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    doc.querySelectorAll('p').forEach(p => {
      const spans = p.querySelectorAll(':scope > span');
      let tab, name, msg;
      if (spans.length >= 3) {
        tab = spans[0].textContent.trim().replace(/^\[|\]$/g, '').trim();
        name = spans[1].textContent.trim();
        // <br>을 줄바꿈으로
        msg =spans[2].innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
        msg = decode(msg).trim();
      } else {
        const m = p.textContent.trim().match(RE.line);
        if (!m) return;
        [, tab, name, msg] = m;
        tab = tab.trim(); name = name.trim(); msg = msg.trim();
      }
      if (!name) return;
      const color = (p.getAttribute('style') || '').match(/color\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/i);
      out.push({ file: fileName, tab: tab || 'main', name, text: msg, color: color ? color[1] : null, roll: parseRoll(msg) });
    });
    return out;
  }

  const ta = typeof document !== 'undefined' ? document.createElement('textarea') : null;
  function decode(s) { if (!ta) return s; ta.innerHTML = s; return ta.value; }

  /* 판정마다 같은 탭의 앞뒤 대사(판정이 아닌 줄)를 붙임 */
  function attachContext(entries, n = 2) {
    entries.forEach((e, i) => {
      if (!e.roll) return;
      const pick = (dir) => {
        const got = [];
        for (let j = i + dir; j >= 0 && j < entries.length && got.length < n; j += dir) {
          const o = entries[j];
          if (o.file !== e.file) break;
          if (o.tab === e.tab && !o.roll) got.push({ name: o.name, text: o.text });
        }
        return dir < 0 ? got.reverse() : got;
      };
      e.roll.before = pick(-1);
      e.roll.after = pick(1);
    });
    return entries;
  }

  global.CCParser = { parseLog, parseRoll, attachContext, GRADES, SUCCESS, RE };
})(typeof window !== 'undefined' ? window : globalThis);
