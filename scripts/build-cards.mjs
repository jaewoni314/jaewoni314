#!/usr/bin/env node
/**
 * 프로필 README 에 쓰는 SVG 카드를 만든다.
 *
 *   GITHUB_TOKEN=$(gh auth token) node scripts/build-cards.mjs
 *
 * - 의존성 없음. Node 18 이상의 내장 fetch 만 쓴다.
 * - 공개 저장소 활동만 그린다. 어떤 토큰으로 돌려도 비공개 저장소 이름은 들어가지 않는다.
 * - 결과에 날짜 도장을 찍지 않는다. 활동이 그대로면 파일도 그대로라서 빈 커밋이 생기지 않는다.
 */
import { mkdir, writeFile } from 'node:fs/promises';

// ───────────────────────── 설정 ─────────────────────────

const LOGIN = process.env.PROFILE_LOGIN ?? 'jaewoni314';

const HERO = {
  text: 'JAEWON KIM',
  top: "Hello, I'm",
  bottom: 'Frontend Developer · React · TypeScript · Kotlin',
};

/** 저장소 이름 대신 보여줄 이름. 없으면 저장소 이름을 그대로 쓴다. */
const REPO_LABELS = {
  'PicTree-UMC/PicTree-Frontend': 'PicTree · Frontend',
  'HSU-Makeus-Challenge-11th/Web_C': 'UMC 11th · Web',
  'HSU-Makeus-Challenge-10th/Web': 'UMC 10th · Web',
  'acylelli/Mobile-Programming': 'RouteAlarm · Android',
  'Jiin5906/CodeDiagram': 'CodeRefactor · Capstone',
};

const MAX_PROJECTS = 6; // 프로젝트별 잔디에 그릴 저장소 수 (최대)
const MIN_PROJECT_COMMITS = 10; // 최근 1년 커밋이 이보다 적은 저장소는 프로젝트별 잔디에서 뺀다
const MAX_LABEL_LENGTH = 26; // 이보다 긴 저장소 이름은 말줄임표로 줄인다
const MAX_LANGUAGES = 6; // 언어 카드에 그릴 언어 수 (넘치면 마지막 칸이 '기타')
const MIN_WEEKS = 26; // 프로젝트별 잔디의 최소 가로 길이(주)

const OUT_DIR = new URL('../assets/', import.meta.url);

// ───────────────────────── 테마 ─────────────────────────

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/** grass 는 GitHub 잔디 5단계 색. 0 이 빈 칸, 4 가 가장 진한 칸. */
const THEMES = {
  light: {
    card: '#ffffff',
    border: '#d1d9e0',
    text: '#1f2328',
    muted: '#59636e',
    faint: '#818b98',
    accent: '#1a7f37',
    grass: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    other: '#afb8c1',
  },
  dark: {
    card: '#0d1117',
    border: '#3d444d',
    text: '#f0f6fc',
    muted: '#9198a1',
    faint: '#6e7681',
    accent: '#3fb950',
    grass: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    other: '#484f58',
  },
};

// ───────────────────────── 도구 ─────────────────────────

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 좌표를 소수 둘째 자리까지만 남긴다. */
const px = (v) => String(Math.round(v * 100) / 100);

const num = (v) => v.toLocaleString('en-US');

/** 같은 입력이면 늘 같은 난수열을 주는 생성기. 결과 파일이 실행할 때마다 달라지지 않게 한다. */
function seededRandom(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 값이 최댓값에 견줘 얼마나 큰지를 잔디 단계(0~4)로 바꾼다. 작은 값도 보이도록 제곱근 눈금을 쓴다. */
function grassLevel(value, max) {
  if (value <= 0 || max <= 0) return 0;
  const ratio = Math.sqrt(value / max);
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function svgOpen({ width, height, title, desc, style }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<style>${style}</style>
`;
}

function baseStyle(t) {
  return `
  text { font-family: ${SANS}; }
  .mono { font-family: ${MONO}; }
  .fg { fill: ${t.text}; }
  .muted { fill: ${t.muted}; }
  .faint { fill: ${t.faint}; }
  .label { font-family: ${MONO}; font-size: 11px; font-weight: 600; letter-spacing: 1.1px; fill: ${t.accent}; }
  .note { font-size: 11.5px; fill: ${t.muted}; }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { transform: scaleY(0); } }
  @keyframes grow { from { transform: scaleX(0); } }
  .fade { animation: fade 0.5s ease-out backwards; }
  .rise { transform-box: fill-box; transform-origin: 50% 100%; animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
  .grow { transform-box: fill-box; transform-origin: 0 50%; animation: grow 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`;
}

function frame(t, width, height) {
  return `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${t.card}" stroke="${t.border}"/>\n`;
}

/** GitHub 잔디 아래의 'Less ▢▢▢▢▢ More' 범례. right 는 범례의 오른쪽 끝, y 는 글자 기준선. */
function legend(t, right, y) {
  const size = 10;
  const pitch = 13;
  const boxesRight = right - 36;
  const boxesLeft = boxesRight - (pitch * 5 - (pitch - size));
  let out = `<text x="${px(right)}" y="${px(y)}" text-anchor="end" class="faint" font-size="11.5">More</text>\n`;
  t.grass.forEach((color, i) => {
    out += `<rect x="${px(boxesLeft + i * pitch)}" y="${px(y - 9)}" width="${size}" height="${size}" rx="2.5" fill="${color}"/>\n`;
  });
  out += `<text x="${px(boxesLeft - 6)}" y="${px(y)}" text-anchor="end" class="faint" font-size="11.5">Less</text>\n`;
  return out;
}

// ───────────────────────── 히어로: 잔디로 쓴 이름 ─────────────────────────

/** 5×7 도트 글꼴. '#' 이 켜진 칸. */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
};

const HERO_ROWS = 7;
const LETTER_GAP = 2; // 글자 사이 빈 열
const WORD_GAP = 5; // 낱말 사이 빈 열
const SIDE_PAD = 1; // 양 끝 빈 열

/** 켜질 칸의 위치를 정한다. 반환: { cols, lit: Set('열,행') } */
function layoutHero(text) {
  const lit = new Set();
  let col = SIDE_PAD;
  text
    .toUpperCase()
    .split(/\s+/)
    .forEach((word, wordIndex) => {
      if (wordIndex > 0) col += WORD_GAP - LETTER_GAP;
      for (const ch of word) {
        const glyph = GLYPHS[ch];
        if (!glyph) throw new Error(`도트 글꼴에 '${ch}' 가 없습니다. GLYPHS 에 추가해 주세요.`);
        glyph.forEach((line, row) => {
          [...line].forEach((mark, dx) => {
            if (mark === '#') lit.add(`${col + dx},${row}`);
          });
        });
        col += glyph[0].length + LETTER_GAP;
      }
    });
  return { cols: col - LETTER_GAP + SIDE_PAD, lit };
}

function renderHero(t) {
  const width = 880;
  const height = 196;
  const pitch = 13;
  const size = 10;
  const { cols, lit } = layoutHero(HERO.text);
  const gridWidth = cols * pitch - (pitch - size);
  if (gridWidth > width - 32) throw new Error(`히어로 문구가 너무 깁니다 (${cols}열). HERO.text 를 줄여 주세요.`);
  const x0 = (width - gridWidth) / 2;
  const y0 = 54;
  const right = x0 + gridWidth;
  const random = seededRandom(`hero:${HERO.text}`);
  const sweepMs = 16; // 글자가 왼쪽에서 오른쪽으로 켜지는 속도(열마다)

  let cells = '';
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < HERO_ROWS; r++) {
      const at = `x="${px(x0 + c * pitch)}" y="${px(y0 + r * pitch)}" width="${size}" height="${size}" rx="2.5"`;
      if (lit.has(`${c},${r}`)) {
        // 글자는 진한 두 단계만 섞어서, 잔디 느낌은 살리되 또렷하게 읽히게 한다.
        const level = random() < 0.45 ? 3 : 4;
        const delay = Math.round(c * sweepMs + random() * 180);
        cells += `<rect class="on" ${at} fill="${t.grass[level]}" style="animation-delay:${delay}ms"/>\n`;
      } else if (random() < 0.05) {
        // 빈 칸 가운데 몇 개는 가끔 연하게 켜졌다 꺼진다.
        cells += `<rect class="tw" ${at} fill="${t.grass[0]}" style="animation-delay:${Math.round(random() * 9000)}ms"/>\n`;
      } else {
        cells += `<rect ${at} fill="${t.grass[0]}"/>\n`;
      }
    }
  }

  const style = `${baseStyle(t)}
  @keyframes on { from { fill: ${t.grass[0]}; } }
  @keyframes twinkle { 0%, 72%, 100% { fill: ${t.grass[0]}; } 80%, 92% { fill: ${t.grass[1]}; } }
  .on { animation: on 0.5s ease-out backwards; }
  .tw { animation: twinkle 9s ease-in-out infinite backwards; }
`;

  return (
    svgOpen({
      width,
      height,
      title: `${HERO.top} ${HERO.text}`,
      desc: `GitHub 잔디 칸으로 쓴 이름 ${HERO.text}. ${HERO.bottom}`,
      style,
    }) +
    frame(t, width, height) +
    `<text x="${px(x0)}" y="36" class="muted" font-size="15">${esc(HERO.top)}</text>\n` +
    `<text x="${px(right)}" y="36" text-anchor="end" class="mono faint" font-size="12.5">@${esc(LOGIN)}</text>\n` +
    cells +
    `<text x="${px(x0)}" y="172" class="muted" font-size="13.5">${esc(HERO.bottom)}</text>\n` +
    legend(t, right, 172) +
    `</svg>\n`
  );
}

// ───────────────────────── 카드 1: 최근 1년 요약 ─────────────────────────

function renderSummary(t, data) {
  const width = 420;
  const height = 196;
  const left = 24;
  const right = width - 24;

  // 달마다 막대 하나.
  const barsLeft = 190;
  const barPitch = (right - barsLeft) / data.months.length;
  const barWidth = Math.min(11, barPitch - 5);
  const baseline = 100;
  const maxBar = 54;
  const monthMax = Math.max(1, ...data.months.map((m) => m.total));
  let bars = '';
  data.months.forEach((month, i) => {
    const x = barsLeft + i * barPitch + (barPitch - barWidth) / 2;
    const h = month.total > 0 ? Math.max(3, (month.total / monthMax) * maxBar) : 2;
    const color = t.grass[grassLevel(month.total, monthMax)];
    bars += `<rect class="rise" x="${px(x)}" y="${px(baseline - h)}" width="${px(barWidth)}" height="${px(h)}" rx="2" fill="${color}" style="animation-delay:${i * 45}ms"><title>${month.key}: ${month.total}</title></rect>\n`;
    bars += `<text x="${px(x + barWidth / 2)}" y="${baseline + 14}" text-anchor="middle" class="faint" font-size="9.5">${month.month}</text>\n`;
  });

  const stats = [
    ['커밋', data.commits],
    ['PR', data.pullRequests],
    ['이슈', data.issues],
    // 비공개 기여를 프로필에 공개해 둔 경우에만 그 수를 보여준다.
    data.restricted > 0 ? ['비공개', data.restricted] : ['활동한 날', data.activeDays],
  ];
  const columnWidth = (right - left) / stats.length;
  let statCells = '';
  stats.forEach(([label, value], i) => {
    const x = left + i * columnWidth;
    statCells += `<text x="${px(x)}" y="162" class="fg" font-size="19" font-weight="700">${num(value)}</text>\n`;
    statCells += `<text x="${px(x)}" y="180" class="note">${esc(label)}</text>\n`;
  });

  return (
    svgOpen({
      width,
      height,
      title: `최근 1년 기여 ${num(data.total)}회`,
      desc: `커밋 ${data.commits}, PR ${data.pullRequests}, 이슈 ${data.issues}, 활동한 날 ${data.activeDays}일`,
      style: baseStyle(t),
    }) +
    frame(t, width, height) +
    `<text x="${left}" y="36" class="label">CONTRIBUTIONS</text>\n` +
    `<text x="${right}" y="36" text-anchor="end" class="note">최근 1년</text>\n` +
    `<text x="${left - 2}" y="92" class="fg fade" font-size="46" font-weight="700" letter-spacing="-1">${num(data.total)}</text>\n` +
    `<text x="${left}" y="114" class="note">contributions</text>\n` +
    bars +
    `<line x1="${left}" y1="132.5" x2="${right}" y2="132.5" stroke="${t.border}"/>\n` +
    statCells +
    `</svg>\n`
  );
}

// ───────────────────────── 카드 2: 언어별 커밋 ─────────────────────────

function renderLanguages(t, data) {
  const width = 420;
  const height = 196;
  const left = 24;
  const right = width - 24;
  const barY = 56;
  const barHeight = 10;
  const barWidth = right - left;
  const total = data.languages.reduce((sum, l) => sum + l.commits, 0);
  const gap = 2;

  // 너무 얇은 조각도 보이도록 최소 너비를 주고, 남은 너비를 비율대로 나눈다.
  const minSegment = 4;
  const usable = barWidth - gap * (data.languages.length - 1);
  const flexible = usable - minSegment * data.languages.length;
  let cursor = left;
  let segments = '';
  for (const lang of data.languages) {
    const w = total > 0 ? minSegment + (lang.commits / total) * flexible : usable / data.languages.length;
    segments += `<rect x="${px(cursor)}" y="${barY}" width="${px(w)}" height="${barHeight}" fill="${lang.color ?? t.other}"><title>${esc(lang.name)}: ${lang.commits}</title></rect>\n`;
    cursor += w + gap;
  }

  const columnWidth = (barWidth - 24) / 2;
  let items = '';
  data.languages.forEach((lang, i) => {
    const x = left + (i % 2) * (columnWidth + 24);
    const y = 100 + Math.floor(i / 2) * 28;
    const percent = total > 0 ? (lang.commits / total) * 100 : 0;
    const percentText = percent >= 10 ? percent.toFixed(0) : percent.toFixed(1);
    items += `<g class="fade" style="animation-delay:${200 + i * 70}ms">\n`;
    items += `<circle cx="${px(x + 5)}" cy="${px(y - 4.5)}" r="5" fill="${lang.color ?? t.other}"/>\n`;
    items += `<text x="${px(x + 17)}" y="${y}" class="fg" font-size="13">${esc(lang.name)}</text>\n`;
    items += `<text x="${px(x + columnWidth)}" y="${y}" text-anchor="end" class="muted" font-size="12">${percentText}%</text>\n`;
    items += `</g>\n`;
  });

  return (
    svgOpen({
      width,
      height,
      title: '언어별 커밋 비율',
      desc: data.languages.map((l) => `${l.name} ${l.commits}`).join(', '),
      style: baseStyle(t),
    }) +
    frame(t, width, height) +
    `<text x="${left}" y="36" class="label">COMMITS BY LANGUAGE</text>\n` +
    `<text x="${right}" y="36" text-anchor="end" class="note">저장소 주 언어 기준</text>\n` +
    `<clipPath id="bar"><rect x="${left}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${barHeight / 2}"/></clipPath>\n` +
    `<g clip-path="url(#bar)"><g class="grow">\n${segments}</g></g>\n` +
    items +
    `</svg>\n`
  );
}

// ───────────────────────── 카드 3: 프로젝트별 잔디 ─────────────────────────

function renderProjects(t, data) {
  const width = 880;
  const left = 24;
  const right = width - 24;
  const gridLeft = 236;
  const gridRight = right - 50;
  const weeks = data.weeks;
  const pitch = (gridRight - gridLeft) / weeks.length;
  const size = Math.min(16, pitch - 3);
  const rowHeight = Math.max(24, size + 8);
  const rowsTop = 76;
  const rowsBottom = rowsTop + data.projects.length * rowHeight;
  const height = rowsBottom + 42;
  const weekMax = Math.max(1, ...data.projects.flatMap((p) => p.weekly));

  // 달이 바뀌는 주 위에 달 이름을 적는다. 글자가 겹칠 만큼 가까우면 건너뛴다.
  let months = '';
  let lastLabelAt = -Infinity;
  weeks.forEach((week, i) => {
    const changed = i === 0 || week.month !== weeks[i - 1].month;
    if (!changed) return;
    const nextChange = weeks.findIndex((w, j) => j > i && w.month !== week.month);
    const room = (nextChange === -1 ? weeks.length : nextChange) - i;
    if (i === 0 && room < 2) return;
    if ((i - lastLabelAt) * pitch < 26) return;
    months += `<text x="${px(gridLeft + i * pitch)}" y="64" class="faint" font-size="10.5">${week.month}월</text>\n`;
    lastLabelAt = i;
  });

  let rows = '';
  data.projects.forEach((project, r) => {
    const top = rowsTop + r * rowHeight;
    const middle = top + rowHeight / 2;
    rows += `<circle cx="${left + 5}" cy="${px(middle)}" r="5" fill="${project.color ?? t.other}"/>\n`;
    rows += `<text x="${left + 18}" y="${px(middle + 4.5)}" class="fg" font-size="13">${esc(project.label)}</text>\n`;
    project.weekly.forEach((count, i) => {
      const title = count > 0 ? `<title>${weeks[i].start} 주: ${count} commits</title>` : '';
      const cls = count > 0 ? ' class="fade"' : '';
      const delay = count > 0 ? ` style="animation-delay:${i * 14}ms"` : '';
      rows += `<rect${cls} x="${px(gridLeft + i * pitch)}" y="${px(middle - size / 2)}" width="${px(size)}" height="${px(size)}" rx="2.5" fill="${t.grass[grassLevel(count, weekMax)]}"${delay}>${title}</rect>\n`;
    });
    rows += `<text x="${right}" y="${px(middle + 4.5)}" text-anchor="end" class="mono fg" font-size="13" font-weight="600">${num(project.commits)}</text>\n`;
  });

  return (
    svgOpen({
      width,
      height,
      title: '프로젝트별 주간 커밋',
      desc: data.projects.map((p) => `${p.label} ${p.commits}`).join(', '),
      style: baseStyle(t),
    }) +
    frame(t, width, height) +
    `<text x="${left}" y="36" class="label">COMMITS BY PROJECT</text>\n` +
    `<text x="${right}" y="36" text-anchor="end" class="note">한 칸 = 한 주 · 최근 ${weeks.length}주</text>\n` +
    months +
    rows +
    `<text x="${left}" y="${rowsBottom + 23}" class="faint" font-size="11.5">공개 저장소 기준</text>\n` +
    legend(t, right, rowsBottom + 23) +
    `</svg>\n`
  );
}

// ───────────────────────── GitHub 데이터 ─────────────────────────

async function graphql(query, variables) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN 이 없습니다. 예: GITHUB_TOKEN=$(gh auth token) node scripts/build-cards.mjs');
  }
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'profile-cards',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors) {
    throw new Error(`GitHub API 오류 (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}

const SUMMARY_QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      startedAt
      endedAt
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

/** 저장소별·날짜별 커밋 수. 한 번에 100일치까지만 내려오므로 90일씩 끊어서 묻는다. */
function repoDaysQuery(windows) {
  const parts = windows.map(
    (w, i) => `
    w${i}: contributionsCollection(from: "${w.from}", to: "${w.to}") {
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner name isPrivate primaryLanguage { name color } }
        contributions(first: 100) { nodes { occurredAt commitCount } }
      }
    }`,
  );
  return `query ($login: String!) { user(login: $login) {${parts.join('')}\n  } }`;
}

function splitWindows(startedAt, endedAt, days = 90) {
  const windows = [];
  const end = new Date(endedAt).getTime();
  let from = new Date(startedAt).getTime();
  while (from < end) {
    const to = Math.min(end, from + days * 86_400_000 - 1000);
    windows.push({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    from = to + 1000;
  }
  return windows;
}

async function loadData() {
  const { user } = await graphql(SUMMARY_QUERY, { login: LOGIN });
  if (!user) throw new Error(`사용자 '${LOGIN}' 를 찾지 못했습니다.`);
  const collection = user.contributionsCollection;
  const calendarWeeks = collection.contributionCalendar.weeks.filter((w) => w.contributionDays.length > 0);
  const days = calendarWeeks.flatMap((w) => w.contributionDays);

  // 이번 달까지 12개 달. 달력의 마지막 날을 기준으로 삼아 실행 시각·시간대에 흔들리지 않게 한다.
  const lastDate = days[days.length - 1].date;
  const [lastYear, lastMonth] = lastDate.split('-').map(Number);
  const months = [];
  for (let back = 11; back >= 0; back--) {
    const date = new Date(Date.UTC(lastYear, lastMonth - 1 - back, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    months.push({ key, month: date.getUTCMonth() + 1, total: 0 });
  }
  const monthByKey = new Map(months.map((m) => [m.key, m]));
  for (const day of days) {
    const month = monthByKey.get(day.date.slice(0, 7));
    if (month) month.total += day.contributionCount;
  }

  // 저장소별 날짜별 커밋.
  const windows = splitWindows(collection.startedAt, collection.endedAt);
  const windowData = (await graphql(repoDaysQuery(windows), { login: LOGIN })).user;
  const repos = new Map();
  for (const key of Object.keys(windowData)) {
    for (const entry of windowData[key].commitContributionsByRepository) {
      if (entry.repository.isPrivate) continue; // 비공개 저장소는 이름조차 쓰지 않는다.
      const id = entry.repository.nameWithOwner;
      if (!repos.has(id)) {
        repos.set(id, {
          id,
          label: REPO_LABELS[id] ?? entry.repository.name,
          language: entry.repository.primaryLanguage?.name ?? null,
          color: entry.repository.primaryLanguage?.color ?? null,
          commits: 0,
          byDate: new Map(),
        });
      }
      const repo = repos.get(id);
      for (const node of entry.contributions.nodes) {
        // 창의 경계에 걸친 날은 앞뒤 창 양쪽에 그날 전체 커밋 수로 한 번씩 나온다.
        // 더하면 두 번 세게 되므로 덮어써서 한 번만 센다.
        repo.byDate.set(node.occurredAt.slice(0, 10), node.commitCount);
      }
    }
  }
  for (const repo of repos.values()) {
    repo.commits = [...repo.byDate.values()].reduce((sum, count) => sum + count, 0);
  }
  const ranked = [...repos.values()].sort((a, b) => b.commits - a.commits || a.id.localeCompare(b.id));

  // 언어별 합계.
  const byLanguage = new Map();
  for (const repo of ranked) {
    const name = repo.language ?? '기타';
    const entry = byLanguage.get(name) ?? { name, color: repo.language ? repo.color : null, commits: 0 };
    entry.commits += repo.commits;
    byLanguage.set(name, entry);
  }
  let languages = [...byLanguage.values()].sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  if (languages.length > MAX_LANGUAGES) {
    const rest = languages.slice(MAX_LANGUAGES - 1);
    languages = [
      ...languages.slice(0, MAX_LANGUAGES - 1),
      { name: '기타', color: null, commits: rest.reduce((sum, l) => sum + l.commits, 0) },
    ];
  }

  // 프로젝트별 잔디: 달력의 주를 그대로 열로 쓴다.
  const weekIndexByDate = new Map();
  calendarWeeks.forEach((week, i) => week.contributionDays.forEach((d) => weekIndexByDate.set(d.date, i)));
  // 커밋이 어느 정도 쌓인 저장소만 고른다. 그런 저장소가 거의 없으면 위에서 셋을 그냥 보여준다.
  const busy = ranked.filter((repo) => repo.commits >= MIN_PROJECT_COMMITS);
  const chosen = (busy.length >= 3 ? busy : ranked.slice(0, 3)).slice(0, MAX_PROJECTS);
  const projects = chosen.map((repo) => {
    const weekly = new Array(calendarWeeks.length).fill(0);
    for (const [date, count] of repo.byDate) {
      const index = weekIndexByDate.get(date);
      if (index !== undefined) weekly[index] += count;
    }
    const label =
      repo.label.length > MAX_LABEL_LENGTH ? `${repo.label.slice(0, MAX_LABEL_LENGTH - 1)}…` : repo.label;
    return { label, color: repo.color, commits: repo.commits, weekly };
  });
  // 첫 커밋 한 주 앞에서 시작하되, 너무 짧아지지 않게 한다.
  const firstActive = Math.min(
    calendarWeeks.length - 1,
    ...projects.map((p) => p.weekly.findIndex((v) => v > 0)).filter((i) => i >= 0),
  );
  const start = Math.max(0, Math.min(firstActive - 1, calendarWeeks.length - MIN_WEEKS));
  const weeks = calendarWeeks.slice(start).map((week) => ({
    start: week.contributionDays[0].date,
    month: Number(week.contributionDays[0].date.slice(5, 7)),
  }));
  for (const project of projects) project.weekly = project.weekly.slice(start);

  return {
    total: collection.contributionCalendar.totalContributions,
    commits: collection.totalCommitContributions,
    pullRequests: collection.totalPullRequestContributions,
    issues: collection.totalIssueContributions,
    restricted: collection.restrictedContributionsCount,
    activeDays: days.filter((d) => d.contributionCount > 0).length,
    months,
    languages,
    projects,
    weeks,
  };
}

// ───────────────────────── 실행 ─────────────────────────

async function main() {
  const data = await loadData();
  await mkdir(OUT_DIR, { recursive: true });
  const cards = {
    hero: (t) => renderHero(t),
    summary: (t) => renderSummary(t, data),
    languages: (t) => renderLanguages(t, data),
    projects: (t) => renderProjects(t, data),
  };
  for (const [name, render] of Object.entries(cards)) {
    for (const [themeName, theme] of Object.entries(THEMES)) {
      await writeFile(new URL(`${name}-${themeName}.svg`, OUT_DIR), render(theme));
    }
  }
  console.log(
    `카드 ${Object.keys(cards).length * 2}개를 만들었습니다 · 기여 ${data.total} · 커밋 ${data.commits} · 프로젝트 ${data.projects.length} · 언어 ${data.languages.length}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
