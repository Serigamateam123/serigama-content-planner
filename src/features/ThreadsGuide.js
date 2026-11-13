import { html } from '../lib/html.js';
import { useState, useEffect } from 'preact/hooks';

// Threads playbook for @serigamahq: how other Malaysian brands (Watsons, MYDIN, …) are
// active on Threads, with their screenshots as examples, and Serigama's own routine.
// Opened from the Content Calendar ("📘 Threads guide"). Screenshots live in
// public/guide/threads/ (ID / licence photos in them are blurred).

const IMG = (n) => `./public/guide/threads/${n}.jpg`;

// Each example: screenshot + what the brand did + what Serigama can copy.
const EXAMPLES = [
  { n: 1, brand: 'Watsons', title: 'Story first, promo second (thread 1/2 → 2/2)',
    what: 'Part 1/2 is a funny, relatable moment in the store ("Awk nak yang mana?…" — he was asking his wife, not them). Part 2/2 is the sale + link.',
    numbers: 'Story part: 804 likes · Promo part: 9 likes',
    copy: 'Open with a small real story from Serigama HQ or a customer. Put the product / link only in the 2nd part.' },
  { n: 2, brand: 'Watsons', title: 'Ride the moment everyone is talking about',
    what: '"Sape nampak malam tadi" — a photo of the 11.11 drone show over KLCC the morning after.',
    numbers: '1.4K likes · 55 replies · 36 reposts',
    copy: 'When something is trending (11.11, Deepavali, Raya, a viral drone show), post about it the same day with a light link to Serigama.' },
  { n: 3, brand: 'KUSKOP (official ministry)', title: 'Post into a topic community',
    what: 'Posted inside "Business Threads" (see "> Business Threads" next to the name) with a playful question: "Min nak tanya ni 🙊 janji tak reject 🙈".',
    numbers: 'Reaches people who follow the topic, not only followers',
    copy: 'When you post, add a topic (Business Threads, health, food…) so new people see it.' },
  { n: 4, brand: 'MYDIN', title: 'Reply under other brands\' posts',
    what: 'Short lines ("Okay ke tu") and a reaction GIF ("Shhhh") under Watsons and others.',
    numbers: 'Watsons\' post: 9.7K likes — MYDIN is seen by that whole audience',
    copy: 'Reply to friendly brands (Watsons, MYDIN, Zus, Mamee, Kicap Jalen) with one short funny line or a GIF.' },
  { n: 5, brand: 'MYDIN', title: 'A GIF reply on a big brand post',
    what: '"Hi coffee bean" + a peeking cartoon GIF, under Coffee Bean\'s "Dear diary" post (74.4K views).',
    numbers: 'MYDIN\'s reply: 150 likes',
    copy: 'A GIF says more than text and stands out in a long reply list. Keep it friendly, never mocking.' },
  { n: 6, brand: 'MYDIN', title: 'Join the "spill the tea" games',
    what: 'Kicap Jalen teased "nak spill the tea"; MYDIN replied with a peeking-through-the-blinds GIF.',
    numbers: 'MYDIN\'s reply: 205 likes',
    copy: 'When a brand plays a game or teases, play along fast — early replies get the most views.' },
  { n: 7, brand: 'MYDIN', title: 'Reply to viral posts from ordinary people',
    what: '"Ingatkan kembar. Orang berbeza rupanya" under a viral look-alike post.',
    numbers: 'The original post: 15.9K likes · 550 replies',
    copy: 'Find viral posts (1K+ likes) where a short funny line fits naturally. Don\'t promote in these replies.' },
  { n: 8, brand: 'MYDIN', title: 'Soft-sell with a personal touch',
    what: '"Happy Birthday aaiman.jerrr 🎉 Jangan lupa tebus baucar RM5 dekat MYDIN Rewards tau" — the person answered "Free2 saya pergi ye 🤍".',
    numbers: '141 likes and a real conversation with a customer',
    copy: 'Birthdays, weddings, new babies, recoveries: congratulate warmly, mention Serigama only if it truly helps (e.g. a promo or tip).' },
  { n: 9, brand: 'MYDIN', title: 'Show up on every birthday / trend post',
    what: 'The same birthday trend — MYDIN replied on many of these posts, one after another.',
    numbers: 'Same 1-minute reply, many audiences',
    copy: 'When a trend repeats (birthdays, "korang team apa?"), reply on several of them — but write each reply differently.' },
  { n: 10, brand: 'Watsons × Zus × Mamee Monster', title: 'Brands banter with each other',
    what: '"Hai kawan lama" (Mamee Monster) → "2 is better than 1 kannn @zus.coffee 😍" (Watsons) → Zus replies with a cat GIF.',
    numbers: 'Mamee Monster\'s reply: 1K likes',
    copy: 'Be friends with other brands in public. Tag them playfully (once), and reply when they tag you.' },
];

export function ThreadsGuide({ onBack }) {
  const [zoom, setZoom] = useState(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setZoom(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const card = (title, body) => html`<div class="card card-pad section-gap"><div class="card-title">${title}</div>${body}</div>`;

  return html`<div class="tg">
    <div class="page-head">
      <div>
        <div class="eyebrow">Planning · Threads</div>
        <h1 class="page-title">📘 Threads guide <span class="muted" style=${{ fontWeight: 500, fontSize: '0.6em' }}>· @serigamahq</span></h1>
      </div>
      <div class="page-actions"><button class="btn" onClick=${onBack}>← Back to calendar</button></div>
    </div>

    <div class="card card-pad section-gap tg-lead">
      <strong>The big idea:</strong> on Threads, brands grow by <strong>replying more than posting</strong>.
      A reply under a viral post is seen by that post's whole audience — MYDIN's Replies tab is full, their own posts are few.
      Your planner already tracks every reply (Post Performance → @serigamahq · Threads → Replies) and shows them on the calendar in red.
    </div>

    ${card('🗓️ Daily routine (30–45 minutes)', html`
      <div style=${{ overflowX: 'auto' }}><table class="atable">
        <thead><tr><th>When</th><th>What</th><th>How many</th></tr></thead>
        <tbody>
          <tr><td>Morning (9–10 AM)</td><td>Scroll “For you”, reply to trending / viral posts</td><td>5–8 replies</td></tr>
          <tr><td>Lunch (12–2 PM)</td><td>Reply to other brands (Watsons, MYDIN, Zus, Kicap Jalen, Mamee)</td><td>3–5 replies</td></tr>
          <tr><td>Night (8–11 PM, peak)</td><td>1 own post + answer everyone who replied to you</td><td>1 post + all replies</td></tr>
        </tbody>
      </table></div>
      <p class="muted" style=${{ fontSize: '12.5px', margin: '8px 0 0' }}><strong>Weekly target:</strong> about 70 replies (10–15 a day) and 4–5 own posts. Replies grow the account; posts give people a reason to follow.</p>`)}

    ${card('🎯 Where to reply (best first)', html`<ol class="tg-list">
      <li><strong>Viral posts from ordinary people</strong> (1K+ likes) where a short funny line fits — health, family, food, makcik, wellness topics suit Serigama best.</li>
      <li><strong>Big Malaysian brands</strong> — join their banter (MYDIN, Watsons, Mamee are already doing it).</li>
      <li><strong>People asking for help or opinions</strong> — pain, joints, wounds, after giving birth, gifts for parents. Help first; mention jeli gamat only if it truly fits.</li>
      <li><strong>Birthday / wedding / achievement posts</strong> — congratulate, MYDIN-style.</li>
    </ol>`)}

    ${card('✍️ What to post (weekly mix)', html`
      <div style=${{ overflowX: 'auto' }}><table class="atable">
        <thead><tr><th>Type</th><th>Serigama example</th><th>Why it works</th></tr></thead>
        <tbody>
          <tr><td>Story 1/2 → 2/2</td><td>1/2: “Tadi ada customer datang HQ, mak dia suruh beli jeli gamat tapi dia sendiri tak tahu nak cari warna apa 😂” → 2/2: product + where to buy</td><td>The story carries the reach</td></tr>
          <tr><td>Question / poll</td><td>“Korang team jeli gamat sapu atau minum? 🤔” (poll)</td><td>Easy to answer → many replies</td></tr>
          <tr><td>Trending moment</td><td>11.11, Deepavali, a viral meme, a drone show</td><td>People are already talking about it</td></tr>
          <tr><td>Behind the scenes</td><td>Packing orders, the HQ team, “a day at Serigama”</td><td>Feels human</td></tr>
          <tr><td>Giveaway</td><td>“Nak jeli gamat free? Reply cerita paling kelakar korang 👇”</td><td>Huge reply counts</td></tr>
          <tr><td>Testimonial as a story</td><td>“Ada customer cerita, lepas bersalin dia…” (with permission)</td><td>Social proof without a hard sell</td></tr>
        </tbody>
      </table></div>`)}

    ${card('🗣️ Voice & writing rules', html`<ul class="tg-list">
      <li><strong>Who you are:</strong> a friendly “kakak” from Serigama HQ who knows jeli gamat and is a bit funny. Your best replies already sound like this — “saya anak jeli gamat!!!”, “oren bang!!!”.</li>
      <li><strong>Short:</strong> 1–3 lines. Threads isn't Facebook.</li>
      <li><strong>Casual BM + rojak</strong>, emoji, call yourself “Min” or “akak”.</li>
      <li><strong>No promo in replies</strong> unless asked or it's a natural MYDIN-style birthday/voucher mention.</li>
      <li><strong>Reply fast</strong> to people who comment on you — the first hour matters most.</li>
      <li><strong>GIFs / memes</strong> for brand and viral replies. <strong>Tag brands</strong> only when playful, and only once.</li>
      <li><strong>Add a topic</strong> (Business Threads, health, food) when you post.</li>
    </ul>`)}

    ${card('⛔ Avoid', html`<ul class="tg-list">
      <li><strong>Health claims.</strong> Never say jeli gamat “cures” or “heals” anything — share experiences and use soft words like “membantu”. KKM rules on health-product ads are strict, and a viral post with a bad claim can backfire.</li>
      <li><strong>Religion, politics, tragedy</strong> — skip them even when trending. No jokes under sad or sensitive posts.</li>
      <li><strong>Copy-paste replies</strong> — the same line everywhere looks like a bot and Threads may limit you.</li>
      <li><strong>Arguing</strong> — if someone is rude, reply once politely or ignore.</li>
      <li><strong>Sharing people's documents</strong> — never repost IC, licence or address photos.</li>
    </ul>`)}

    <div class="card card-pad section-gap">
      <div class="card-title">📸 Examples from other brands <span class="muted" style=${{ fontWeight: 400 }}>(tap a screenshot to enlarge)</span></div>
      <div class="tg-grid">
        ${EXAMPLES.map((e) => html`<div class="tg-ex">
          <button class="tg-shot" onClick=${() => setZoom(e)} aria-label=${'Enlarge example ' + e.n}>
            <img src=${IMG(e.n)} alt=${e.brand + ': ' + e.title} loading="lazy" />
          </button>
          <div class="tg-ex-body">
            <div class="tg-num">Example ${e.n} · ${e.brand}</div>
            <div class="tg-ex-title">${e.title}</div>
            <p><strong>What they did:</strong> ${e.what}</p>
            <p class="tg-numbers">📊 ${e.numbers}</p>
            <p class="tg-copy"><strong>Serigama can:</strong> ${e.copy}</p>
          </div>
        </div>`)}
      </div>
    </div>

    ${card('📈 Check every Friday (in this planner)', html`<ul class="tg-list">
      <li>Post Performance → @serigamahq · Threads → <strong>Replies</strong>: which replies got the most views, and under whose post? Do more of that.</li>
      <li>Did <strong>followers</strong> grow this week? (216 on 12 Nov.)</li>
      <li>Which of your <strong>own posts</strong> got the most replies?</li>
      <li>Content Calendar: count the red <span class="reply-tag">Reply</span> cards this week — aim for ~70.</li>
    </ul>`)}

    ${zoom ? html`<div class="overlay tg-zoom" onClick=${() => setZoom(null)} role="dialog" aria-modal="true" aria-label="Screenshot">
      <img src=${IMG(zoom.n)} alt=${zoom.brand + ': ' + zoom.title} onClick=${(ev) => ev.stopPropagation()} />
      <button class="x-btn tg-zoom-x" onClick=${() => setZoom(null)} aria-label="Close">×</button>
    </div>` : ''}
  </div>`;
}
