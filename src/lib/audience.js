// Plain-language facts from the TikTok Studio audience capture (`serigama.audience`).
// Everything is looked up BY NAME — never "the first gender" or "the first two age
// bands" — so the wording stays right if Studio changes the order, and every
// sentence built from it follows the latest capture instead of fixed text.

const norm = (s) => String(s || '').toLowerCase().replace(/[‐-―]/g, '-').trim();

// "18–24" -> [18, 24]; "55+" -> [55, null].
const bandRange = (label) => {
  const m = norm(label).match(/^(\d+)\s*(?:-\s*(\d+)|\+)$/);
  return m ? [Number(m[1]), m[2] ? Number(m[2]) : null] : null;
};

const DEMONYMS = { Malaysia: 'Malaysian', Singapore: 'Singaporean', Indonesia: 'Indonesian', Brunei: 'Bruneian', Thailand: 'Thai', Philippines: 'Filipino', 'United States': 'American', 'United Kingdom': 'British' };

export function audienceFacts(aud) {
  if (!aud) return null;
  const find = (arr, name) => (arr || []).find((x) => norm(x.label || x.name) === name);
  const female = find(aud.gender, 'female');
  const male = find(aud.gender, 'male');
  const lead = female && male ? (female.pct >= male.pct ? { word: 'women', pct: female.pct } : { word: 'men', pct: male.pct }) : null;

  // The two neighbouring age bands with the biggest combined share, e.g. 25–44.
  const bands = (aud.age || []).map((a) => ({ ...a, r: bandRange(a.label) })).filter((a) => a.r).sort((x, y) => x.r[0] - y.r[0]);
  let span = null;
  for (let i = 0; i + 1 < bands.length; i++) {
    const pct = Math.round((bands[i].pct + bands[i + 1].pct) * 10) / 10;
    if (!span || pct > span.pct) {
      const hi = bands[i + 1].r[1];
      span = { pct, label: hi == null ? `${bands[i].r[0]}+` : `${bands[i].r[0]}–${hi}`, from: bands[i].r[0] };
    }
  }

  const places = (aud.locations || []).filter((l) => norm(l.name) !== 'others');
  const top = places[0] || null;
  const next = places.slice(1, 3);
  const people = top && lead ? `${DEMONYMS[top.name] ? DEMONYMS[top.name] + ' ' : ''}${lead.word}${DEMONYMS[top.name] ? '' : ' in ' + top.name}` : null;
  return { female, male, lead, span, top, next, people };
}

// 67 -> "About two-thirds", 51 -> "About half"… for leading a sentence.
export function shareWord(pct) {
  if (pct >= 85) return 'Almost all';
  if (pct >= 72) return 'About three-quarters';
  if (pct >= 62) return 'About two-thirds';
  if (pct >= 45) return 'About half';
  if (pct >= 30) return 'About a third';
  return `${pct}%`;
}
