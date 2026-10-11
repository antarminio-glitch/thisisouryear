// The owner's screen. Everything here talks to one server endpoint, with the
// admin password. Nothing on this page works without it, and nothing is saved
// in the browser except the password for this tab, which is forgotten when
// the tab closes.
//
// Every bit of text that came from a stranger (captions, names, notes) is put
// on the page as plain text, never as HTML.
import { data, cities } from './shop-data.js';

const ENDPOINT = '/.netlify/functions/admin';
const KEY = 'tioy-admin';

// ---------- small helpers ----------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const cityName = (slug) => cities.find((c) => c.slug === slug)?.name ?? slug;
const money = (cents) => (Number.isInteger(cents) ? `$${(cents / 100).toFixed(2)}` : '');
const words = (s) => String(s).replace(/_/g, ' ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// A football season is named for the year it starts.
const thisSeason = () => {
  const d = new Date();
  return String(d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear());
};
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

let token = '';
try {
  token = sessionStorage.getItem(KEY) ?? '';
} catch {
  /* private mode: the password just isn't remembered */
}

async function call(action, body = {}) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    return { ok: false, status: 0, body: { error: "Couldn't reach the server. This screen only works on the live site, or locally with the checkout server running." } };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: json };
}
const problem = (res) => res.body.message || res.body.error || `That didn't work (error ${res.status}).`;

// A field with a label, used all over.
function field(label, control, hint = '') {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null);
}
function select(options, value = '') {
  const s = h('select');
  for (const [v, text] of options) s.append(h('option', { value: v, text, selected: v === value }));
  return s;
}
const citySelect = (value = '') => select([['', 'Choose a city'], ...cities.map((c) => [c.slug, c.name])], value);
function note(text, kind = '') {
  return h('p', { class: `note ${kind}`.trim(), role: kind === 'bad' ? 'alert' : 'status', text });
}
function button(text, onclick, quiet = true) {
  return h('button', { class: quiet ? 'btn btn-quiet' : 'btn', type: 'button', text, onclick });
}
// Runs something when a button is pressed, and stops double presses.
function busy(btn, fn) {
  return async (...args) => {
    btn.disabled = true;
    try {
      await fn(...args);
    } finally {
      btn.disabled = false;
    }
  };
}

// ---------- signing in ----------
const root = document.querySelector('[data-admin]');
const gate = root.querySelector('[data-gate]');
const gateMsg = root.querySelector('[data-gate-msg]');
const app = root.querySelector('[data-app]');
const panel = root.querySelector('[data-panel]');
const tabs = [...root.querySelectorAll('[data-tab]')];

function showGate(message = '') {
  app.hidden = true;
  gate.hidden = false;
  gateMsg.textContent = message;
  gateMsg.hidden = !message;
}
async function signIn() {
  const res = await call('status');
  if (res.status === 401) return showGate('Wrong admin password.');
  if (res.status === 503 && res.body.error === 'admin_not_configured') return showGate(res.body.message);
  if (!res.ok) return showGate(problem(res));
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    /* fine */
  }
  gate.hidden = true;
  app.hidden = false;
  open(location.hash.slice(1) || 'setup', res.body);
}
gate.addEventListener('submit', (e) => {
  e.preventDefault();
  token = new FormData(gate).get('password')?.toString() ?? '';
  if (!token) return showGate('Enter the admin password.');
  signIn();
});
root.querySelector('[data-signout]').addEventListener('click', () => {
  token = '';
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* fine */
  }
  panel.textContent = '';
  gate.reset();
  showGate('');
});

const VIEWS = { setup, orders, season, campaigns, quotes, fans };
function open(name, preloaded) {
  if (!VIEWS[name]) name = 'setup';
  for (const t of tabs) t.setAttribute('aria-current', t.dataset.tab === name ? 'page' : 'false');
  history.replaceState(null, '', `#${name}`);
  panel.textContent = '';
  panel.append(h('p', { class: 'hint', text: 'Loading.' }));
  VIEWS[name](preloaded);
}
for (const t of tabs) t.addEventListener('click', () => open(t.dataset.tab));
function fill(...nodes) {
  panel.textContent = '';
  panel.append(...nodes.flat().filter(Boolean));
}
function failed(res) {
  if (res.status === 401) return showGate('Wrong admin password.');
  fill(note(problem(res), 'bad'));
}

// ---------- setup ----------
async function setup(preloaded) {
  const res = preloaded ? { ok: true, body: preloaded } : await call('status');
  if (!res.ok) return failed(res);
  const s = res.body;
  const yes = (v) => (v ? 'On' : 'Off');

  const facts = [
    ['Payments', s.stripe.mode === 'missing' ? 'Not connected' : s.stripe.mode === 'live' ? 'Live. Real cards are charged.' : 'Test mode. No real money.'],
    ['Order records', s.stripe.webhook ? 'On' : 'Off. Paid orders are not being recorded here.'],
    ['Saving things (orders, quotes, photos)', s.storage === 'unavailable' ? 'Not available' : 'Working'],
    ['Site address', s.siteUrl ?? 'Not set'],
    ['Order email to the vendor', s.orderEmail.ready ? `On. Goes to ${s.orderEmail.to.join(', ')}${s.orderEmail.cc.length ? `, copy to ${s.orderEmail.cc.join(', ')}` : ''}.` : `Off. Missing: ${s.orderEmail.missing.join(', ')}.`],
    ['Marketing email', s.email.ready ? 'Ready' : 'Off'],
    ['Color reference', `Version ${s.colors.version}. ${s.colors.appliedSurfaces} surfaces from the reference, ${s.colors.customSurfaces.length} custom.`],
    ['Cities with vendor-approved colors', `${s.colors.vendorApprovedCities} of ${s.colors.cities}`],
    ['Title history', `Through the ${s.history.latestSeason} season. ${s.history.needsRefresh ? 'Needs updating now. Counters are hidden until it is.' : `Update by ${s.history.refreshBy}.`}`],
    ['Ask about marketing email at checkout', yes(s.settings.collectMarketingConsent)],
    ['Gift notes', yes(s.settings.giftNotes)],
    ['Sales tax collection', yes(s.settings.automaticTax)],
    ['Bulk pricing', s.bulkTiers.length ? s.bulkTiers.map((t) => `${t.minQuantity}+ items ${t.percentOff}% off`).join(', ') : 'None'],
  ];
  const counts = s.counts
    ? [
        ['Orders recorded', `${s.counts.orders} (${s.counts.paidOrders} paid)`],
        ['Customers who asked for email', String(s.counts.optedIn)],
        ['Quote requests', `${s.counts.quotes} (${s.counts.newQuotes} new)`],
        ['Fan photos waiting', String(s.counts.fanPending)],
        ['Fan photos showing', String(s.counts.fanApproved)],
        ['Repost queue', String(s.counts.repostQueue)],
      ]
    : [];
  const list = (rows) => h('dl', { class: 'facts' }, rows.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))));

  fill(
    h('h2', { text: 'Setup' }),
    h('p', { class: 'sub', text: `Checked ${when(s.generatedAt)}. This page reads the real settings. It never guesses.` }),
    s.storageError ? note(`Storage isn't available: ${s.storageError}`, 'bad') : null,
    list(facts),
    counts.length ? h('h3', { text: 'So far' }) : null,
    counts.length ? list(counts) : null,
    h('h3', { text: 'For sale' }),
    h(
      'ul',
      { class: 'plain' },
      s.products.map((p) => h('li', {}, h('strong', { text: p.name }), p.sellable ? ' is for sale.' : ` is preview only. Missing: ${p.missing.join(', ')}.`)),
      s.designs.map((d) => h('li', {}, h('strong', { text: d.name }), d.status === 'live' ? ` is live (artwork ${d.artworkVersion}).` : ' is a concept. It can be previewed and never bought.')),
    ),
    h('h3', { text: `Not set up yet (${s.missing.length})` }),
    h('p', { class: 'sub', text: 'The exact name of each setting, and what it holds back.' }),
    h(
      'ul',
      { class: 'missing' },
      s.missing.map((m) => h('li', {}, h('code', { text: m.name }), h('span', { text: m.why }))),
    ),
  );
}

// ---------- season ----------
async function season() {
  let seasonId = thisSeason();
  const draw = async (message = '', kind = '') => {
    const res = await call('season.get', { seasonId });
    if (!res.ok) return failed(res);
    const { meta, states, survivors, options } = res.body;
    const bySlug = new Map(states.map((x) => [x.slug, x]));

    const seasonInput = h('input', { type: 'text', inputMode: 'numeric', value: seasonId, maxLength: 4 });
    const pick = button('Show', () => {
      seasonId = seasonInput.value.trim();
      draw();
    });

    // The round
    const round = select([['', 'Not set'], ...options.ROUNDS.map((r) => [r, words(r)])], meta?.round ?? '');
    const roundSource = h('input', { type: 'url', placeholder: 'https://', value: meta?.sourceUrl ?? '' });
    const roundChecked = h('input', { type: 'checkbox' });
    const saveRound = button('Save the round', null);
    saveRound.addEventListener(
      'click',
      busy(saveRound, async () => {
        const r = await call('season.meta', { seasonId, round: round.value || null, sourceUrl: roundSource.value.trim(), verified: roundChecked.checked });
        draw(r.ok ? 'Round saved.' : problem(r), r.ok ? '' : 'bad');
      }),
    );

    // One city
    const city = citySelect();
    const status = select(options.STATUSES.map((x) => [x, words(x)]), 'unknown');
    const reason = select([['', 'Choose a reason'], ...options.ELIMINATION_REASONS.map((x) => [x, words(x)])]);
    const reasonField = field('Why are they out?', reason, 'One regular-season loss is not an elimination.');
    reasonField.hidden = true;
    status.addEventListener('change', () => (reasonField.hidden = status.value !== 'eliminated'));
    const source = h('input', { type: 'url', placeholder: 'https://' });
    const checked = h('input', { type: 'checkbox' });
    const save = button('Save this city', null, false);
    save.addEventListener(
      'click',
      busy(save, async () => {
        if (!city.value) return draw('Choose a city first.', 'bad');
        const r = await call('season.update', { seasonId, slug: city.value, status: status.value, reason: reason.value || undefined, sourceUrl: source.value.trim(), verified: checked.checked });
        if (!r.ok) return draw(problem(r), 'bad');
        const extra = r.body.canceledSends ? ` ${r.body.canceledSends} pending email${r.body.canceledSends === 1 ? ' was' : 's were'} canceled.` : '';
        draw(`${cityName(city.value)} saved as ${words(r.body.state.status)}.${extra}`);
      }),
    );
    // A single result. Recorded as a note. Never changes the status.
    const result = select([['win', 'Win'], ['loss', 'Loss'], ['tie', 'Tie']]);
    const logResult = button('Record a result', null);
    logResult.addEventListener(
      'click',
      busy(logResult, async () => {
        if (!city.value) return draw('Choose a city first.', 'bad');
        const r = await call('season.update', { seasonId, slug: city.value, result: result.value, sourceUrl: source.value.trim() });
        draw(r.ok ? `Recorded a ${result.value} for ${cityName(city.value)}. Their status did not change.` : problem(r), r.ok ? '' : 'bad');
      }),
    );

    const table = h(
      'table',
      { class: 'wide' },
      h('thead', {}, h('tr', {}, ['City', 'Status', 'Confirmed', 'Source'].map((t) => h('th', { scope: 'col', text: t })))),
      h(
        'tbody',
        {},
        cities.map((c) => {
          const x = bySlug.get(c.slug);
          return h(
            'tr',
            {},
            h('th', { scope: 'row', text: c.name }),
            h('td', { text: x ? cap(words(x.status)) + (x.reason ? ` (${words(x.reason)})` : '') : 'Unknown' }),
            h('td', { text: when(x?.verifiedAt) }),
            h('td', {}, x?.sourceUrl ? h('a', { href: x.sourceUrl, rel: 'noopener noreferrer', target: '_blank', text: 'Source' }) : ''),
          );
        }),
      ),
    );

    fill(
      h('h2', { text: 'Season' }),
      h('p', { class: 'sub', text: 'Every fact is entered by you, with where you checked it. Nothing is guessed and nothing carries over from last season.' }),
      message ? note(message, kind) : null,
      h('div', { class: 'row' }, field('Season (the year it starts)', seasonInput), pick),

      h('h3', { text: 'Where the season is' }),
      h('div', { class: 'cols' }, field('Round', round), field('Where you checked it', roundSource)),
      h('label', { class: 'check' }, roundChecked, h('span', { text: 'I checked this against a source' })),
      saveRound,

      h('h3', { text: 'Playoff picture' }),
      survivors.verified
        ? note(`Confirmed: ${survivors.slugs.length} still alive in the ${words(survivors.round)} round. ${survivors.slugs.map(cityName).join(', ')}.`)
        : note(`Not shown to shoppers. ${survivors.reason}`),

      h('h3', { text: 'Update a city' }),
      h('div', { class: 'cols' }, field('City', city), field('Status', status)),
      reasonField,
      field('Where you checked it', source),
      h('label', { class: 'check' }, checked, h('span', { text: 'I checked this against a source' })),
      h('div', { class: 'btns' }, save),
      h('div', { class: 'row' }, field('Or just note one game', result), logResult),

      h('h3', { text: `All cities, ${seasonId}` }),
      h('div', { class: 'table-scroll' }, table),
    );
  };
  draw();
}

// ---------- campaigns ----------
async function campaigns() {
  const draw = async (message = '', kind = '') => {
    const res = await call('campaigns.get');
    if (!res.ok) return failed(res);
    const { definitions, configs, emailBlockers } = res.body;

    const cards = definitions.map((def) => {
      const c = configs.find((x) => x.id === def.id);
      const seasonInput = h('input', { type: 'text', inputMode: 'numeric', maxLength: 4, value: c.seasonId ?? '' });
      const starts = h('input', { type: 'datetime-local', value: toLocalInput(c.startsAt) });
      const ends = h('input', { type: 'datetime-local', value: toLocalInput(c.endsAt) });
      const confirm = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, placeholder: `ACTIVATE ${def.id}` });
      const settings = () => ({ id: def.id, seasonId: seasonInput.value.trim() || null, ...(def.kind === 'window' ? { startsAt: fromLocalInput(starts.value), endsAt: fromLocalInput(ends.value) } : {}) });

      const save = button('Save dates', null);
      save.addEventListener(
        'click',
        busy(save, async () => {
          const r = await call('campaigns.update', settings());
          draw(r.ok ? `${def.name} saved. It is still ${r.body.config.enabled ? 'on' : 'off'}.` : problem(r), r.ok ? '' : 'bad');
        }),
      );
      const on = button('Turn on', null, false);
      on.addEventListener(
        'click',
        busy(on, async () => {
          const r = await call('campaigns.update', { ...settings(), enabled: true, confirm: confirm.value.trim() });
          draw(r.ok ? `${def.name} is on.` : problem(r), r.ok ? '' : 'bad');
        }),
      );
      const off = button('Turn off', null);
      off.addEventListener(
        'click',
        busy(off, async () => {
          const r = await call('campaigns.update', { id: def.id, enabled: false });
          draw(r.ok ? `${def.name} is off.` : problem(r), r.ok ? '' : 'bad');
        }),
      );

      return h(
        'section',
        { class: 'card' },
        h('h3', {}, def.name, ' ', h('span', { class: 'tag', text: c.enabled ? 'On' : 'Off' })),
        h('p', { class: 'sub', text: `Needs: ${def.needs}` }),
        def.heroTitle ? h('p', { class: 'sub', text: `Shows on the home page: "${def.heroTitle} ${def.heroLine}"` }) : null,
        def.sendsEmail ? h('p', { class: 'sub', text: emailBlockers.length ? `Sends email, and email is off: ${emailBlockers.join('; ')}.` : 'Sends email. Email is set up.' }) : h('p', { class: 'sub', text: 'Does not send email.' }),
        c.enabled ? h('p', { class: 'sub', text: `Turned on ${when(c.activatedAt)} by ${c.activatedBy}.` }) : null,
        h('div', { class: 'cols' }, field('Season', seasonInput), def.kind === 'window' ? field('Starts (your local time)', starts) : null, def.kind === 'window' ? field('Ends (your local time)', ends) : null),
        c.enabled ? h('div', { class: 'btns' }, save, off) : h('div', {}, field(`To turn it on, type: ACTIVATE ${def.id}`, confirm), h('div', { class: 'btns' }, save, on)),
      );
    });

    // Dry run for the elimination follow-up
    const city = citySelect();
    const seasonInput = h('input', { type: 'text', inputMode: 'numeric', maxLength: 4, value: thisSeason() });
    const out = h('div', { class: 'preview-out' });
    const sendConfirm = h('input', { type: 'text', autocomplete: 'off', spellcheck: false });
    const showPlan = (p, sentResult) => {
      out.textContent = '';
      const lines = [
        ['Status', `${cap(words(p.status))}${p.reason ? `. ${p.reason}` : ''}`],
        ['Would receive it', `${p.recipientCount} (${p.segments.standard} bought their own colors, ${p.segments.gift} bought a gift or a punishment)`],
        ['Left out', String(p.exclusions.length)],
        ['Shirt link', p.productLink ?? 'None. There is nothing to link to yet.'],
        ['Campaign switched on', p.campaignEnabled ? 'Yes' : 'No'],
        ['Email set up', p.emailBlockers.length ? `No: ${p.emailBlockers.join('; ')}` : 'Yes'],
      ];
      const parts = [
        note(sentResult ? (sentResult.blocked ? `Nothing was sent. ${sentResult.blocked}` : `Sent ${sentResult.sent}. Failed ${sentResult.failed}. Skipped ${sentResult.skipped}.`) : 'Dry run. Nothing was sent.', sentResult?.blocked ? 'bad' : ''),
        h('dl', { class: 'facts' }, lines.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))),
        p.exclusions.length ? h('ul', { class: 'plain' }, p.exclusions.map((x) => h('li', { text: `${x.who}: ${x.reason}` }))) : null,
        ...Object.entries(p.samples ?? {}).map(([segment, s]) =>
          h('details', {}, h('summary', { text: `The email, ${segment === 'standard' ? 'for people who bought their own colors' : 'for gift and punishment buyers'}` }), h('p', {}, h('strong', { text: `Subject: ${s.subject}` })), h('pre', { text: s.text })),
        ),
      ];
      out.append(...parts.filter(Boolean));
    };
    const preview = button('Run a dry run', null);
    preview.addEventListener(
      'click',
      busy(preview, async () => {
        if (!city.value) return (out.textContent = ''), out.append(note('Choose a city first.', 'bad'));
        const r = await call('campaigns.preview', { slug: city.value, seasonId: seasonInput.value.trim() });
        if (!r.ok) return (out.textContent = ''), out.append(note(problem(r), 'bad'));
        sendConfirm.placeholder = `SEND elimination ${city.value}`;
        showPlan(r.body);
      }),
    );
    const send = button('Send for real', null, false);
    send.addEventListener(
      'click',
      busy(send, async () => {
        if (!city.value) return (out.textContent = ''), out.append(note('Choose a city first.', 'bad'));
        const r = await call('campaigns.send', { slug: city.value, seasonId: seasonInput.value.trim(), confirm: sendConfirm.value.trim() });
        if (r.body.status) showPlan(r.body, r.body.result ?? { blocked: problem(r) });
        else (out.textContent = ''), out.append(note(problem(r), 'bad'));
      }),
    );

    fill(
      h('h2', { text: 'Campaigns' }),
      h('p', { class: 'sub', text: 'Everything starts off. Turning one on takes a typed confirmation. Email only goes out when the campaign is on, email is fully set up, and CAMPAIGNS_LIVE is "true".' }),
      message ? note(message, kind) : null,
      cards,
      h(
        'section',
        { class: 'card' },
        h('h3', { text: 'Elimination follow-up: who would get it' }),
        h('p', { class: 'sub', text: 'A dry run shows the audience and the exact email. It saves nothing and sends nothing.' }),
        h('div', { class: 'cols' }, field('City', city), field('Season', seasonInput)),
        h('div', { class: 'btns' }, preview),
        out,
        h('details', {}, h('summary', { text: 'Send it for real' }), field('Type: SEND elimination, then the city shown in the box', sendConfirm, 'This emails real customers. It cannot be undone. Each person can only ever get it once.'), send),
      ),
    );
  };
  draw();
}

// ---------- orders ----------
async function orders() {
  const draw = async (message = '', kind = '') => {
    const res = await call('orders.list');
    if (!res.ok) return failed(res);
    const { orders: list, orderEmail } = res.body;

    const out = h('div', { class: 'preview-out' });
    const testPreview = button('Preview the order email', null);
    testPreview.addEventListener(
      'click',
      busy(testPreview, async () => {
        const r = await call('orders.test_email', {});
        out.replaceChildren(r.ok ? h('pre', { text: `Subject: ${r.body.preview.subject}\n\n${r.body.preview.text}` }) : note(problem(r), 'bad'));
      }),
    );
    const testSend = button('Send a test email', null);
    testSend.addEventListener(
      'click',
      busy(testSend, async () => {
        const r = await call('orders.test_email', { send: true });
        out.replaceChildren(r.ok ? note(`Test sent to ${r.body.to.join(', ')}${r.body.cc.length ? `, copy to ${r.body.cc.join(', ')}` : ''}. Check that it arrived.`) : note(problem(r), 'bad'));
      }),
    );

    const rows = list.map((o) => {
      const status = o.vendorEmail?.status ?? 'none';
      const words = { sent: `Sent ${when(o.vendorEmail.at)}`, failed: `Failed: ${o.vendorEmail.error ?? ''}`, not_configured: 'Not sent: email not set up', sending: 'Sending', none: 'Not sent' }[status] ?? status;
      const preview = button('See the email', null);
      const holder = h('div');
      preview.addEventListener(
        'click',
        busy(preview, async () => {
          const r = await call('orders.preview', { id: o.id });
          holder.replaceChildren(r.ok ? h('pre', { text: `Subject: ${r.body.subject}\n\n${r.body.text}` }) : note(problem(r), 'bad'));
        }),
      );
      const confirm = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, placeholder: 'SEND' });
      const resend = button('Send to the vendor again', null);
      resend.addEventListener(
        'click',
        busy(resend, async () => {
          const r = await call('orders.email', { id: o.id, confirm: confirm.value.trim() });
          draw(r.ok ? `${o.ref} sent to ${r.body.to.join(', ')}.` : problem(r), r.ok ? '' : 'bad');
        }),
      );
      return h(
        'section',
        { class: 'card' },
        h('h3', {}, o.ref, ' ', h('span', { class: 'tag', text: o.status })),
        h(
          'dl',
          { class: 'facts' },
          [
            ['Paid', when(o.createdAt)],
            ['Items', `${o.units}${o.bulkPercentOff ? `, bulk price ${o.bulkPercentOff}% off` : ''}`],
            ['Total', money(o.totalCents)],
            ['Ship to', o.shipTo ? [o.shipTo.name, [o.shipTo.city, o.shipTo.state].filter(Boolean).join(', ')].filter(Boolean).join(', ') : 'Not recorded'],
            ['Vendor email', words],
            ['Stripe reference', o.id],
          ].map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))),
        ),
        h('div', { class: 'btns' }, preview),
        holder,
        h('details', {}, h('summary', { text: 'Send the vendor email again' }), field('Type SEND to confirm', confirm, 'Only if the vendor lost it. They get a second copy.'), resend),
      );
    });

    fill(
      h('h2', { text: 'Orders' }),
      h('p', { class: 'sub', text: 'Paid orders, from Stripe\'s signed messages. Each one is emailed to the vendor once, automatically. Stripe has the full details, including the customer\'s email.' }),
      message ? note(message, kind) : null,
      orderEmail.ready
        ? note(`Order emails go to ${orderEmail.to.join(', ')}${orderEmail.cc.length ? `, with a copy to ${orderEmail.cc.join(', ')}` : ''}.`)
        : note(`Order emails are off. Missing: ${orderEmail.missing.join(', ')}.`, 'bad'),
      h('div', { class: 'btns' }, testPreview, testSend),
      out,
      h('h3', { text: `Recent orders (${list.length})` }),
      list.length ? rows : note('No paid orders recorded yet. They show up here once the Stripe webhook is set up and someone buys.'),
    );
  };
  draw();
}

// ---------- quotes ----------
async function quotes() {
  const draw = async (message = '', kind = '') => {
    const res = await call('quotes.list');
    if (!res.ok) return failed(res);
    const items = res.body.quotes.map((q) => {
      const status = select(['new', 'answered', 'ordered', 'closed'].map((s) => [s, s]), q.status);
      const ownerNote = h('textarea', { rows: 2, maxLength: 600, value: q.ownerNote ?? '' });
      const save = button('Save', null);
      save.addEventListener(
        'click',
        busy(save, async () => {
          const r = await call('quotes.update', { reference: q.reference, status: status.value, ownerNote: ownerNote.value });
          draw(r.ok ? `${q.reference} saved.` : problem(r), r.ok ? '' : 'bad');
        }),
      );
      return h(
        'section',
        { class: 'card' },
        h('h3', {}, q.reference, ' ', h('span', { class: 'tag', text: q.status })),
        h('p', { class: 'sub', text: `${when(q.createdAt)}. ${q.totalQuantity} items in ${cityName(q.slug)} colors.` }),
        h(
          'dl',
          { class: 'facts' },
          [
            ['From', [q.name, q.email].filter(Boolean).join(', ')],
            ['League', q.leagueName || 'Not given'],
            ['Regular price today', q.regularTotalCentsToday == null ? 'Some rows are not for sale yet, so there is no total.' : `${money(q.regularTotalCentsToday)} before shipping. Not a quote.`],
            ['Notes', q.notes || 'None'],
          ].map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))),
        ),
        h(
          'ul',
          { class: 'plain' },
          q.rows.map((r) => h('li', { text: `${r.quantity} x ${r.productName}, ${r.size}. ${r.availableNow ? `${money(r.unitCentsToday)} each today.` : r.note}` })),
        ),
        h('p', {}, h('a', { href: `mailto:${q.email}?subject=${encodeURIComponent(`Your This Is Our Year quote ${q.reference}`)}`, text: 'Reply by email' })),
        h('div', { class: 'cols' }, field('Status', status), field('Your note', ownerNote)),
        save,
      );
    });
    fill(
      h('h2', { text: 'Quote requests' }),
      h('p', { class: 'sub', text: 'From the fantasy league page. Nothing is charged and no order exists until you reply and they pay.' }),
      message ? note(message, kind) : null,
      items.length ? items : note('No quote requests yet.'),
    );
  };
  draw();
}

// ---------- fan photos ----------
async function fans() {
  let filter = 'pending';
  const draw = async (message = '', kind = '') => {
    const res = await call('fans.list');
    if (!res.ok) return failed(res);
    const all = res.body.submissions;
    const groups = { pending: all.filter((s) => s.status === 'pending'), approved: all.filter((s) => s.status === 'approved'), repost: all.filter((s) => s.repost?.queued), other: all.filter((s) => !['pending', 'approved'].includes(s.status)) };
    const labels = { pending: 'Waiting', approved: 'Showing', repost: 'Repost queue', other: 'Rejected or taken down' };

    const act = (s, doWhat, done) => async () => {
      const r = await call('fans.moderate', { id: s.id, do: doWhat });
      draw(r.ok ? done : problem(r), r.ok ? '' : 'bad');
    };
    const items = groups[filter].map((s) => {
      const holder = h('div', { class: 'thumb' });
      const gone = ['withdrawn', 'removed'].includes(s.status);
      if (gone) holder.append(h('p', { class: 'hint', text: 'Picture deleted.' }));
      else {
        const look = button('Show the photo', null);
        look.addEventListener(
          'click',
          busy(look, async () => {
            const r = await call('fans.photo', { id: s.id });
            if (!r.ok) return holder.replaceChildren(note(problem(r), 'bad'));
            holder.replaceChildren(h('img', { src: `data:${r.body.type};base64,${r.body.base64}`, alt: `Photo ${s.id}` }));
          }),
        );
        holder.append(look);
      }
      const b = (text, doWhat, done, quiet = true) => {
        const el = button(text, null, quiet);
        el.addEventListener('click', busy(el, act(s, doWhat, done)));
        return el;
      };
      const canRepost = s.status === 'approved' && s.permission?.repost === true;
      return h(
        'section',
        { class: 'card fan' },
        holder,
        h(
          'div',
          {},
          h('h3', {}, s.id, ' ', h('span', { class: 'tag', text: s.status })),
          h(
            'dl',
            { class: 'facts' },
            [
              ['City', s.cityName],
              ['Name', s.displayName || 'None'],
              ['Caption', s.caption || 'None'],
              ['Sent', when(s.createdAt)],
              ['May show on the site', s.permission?.display ? 'Yes' : 'No'],
              ['May repost on social', s.permission?.repost ? 'Yes' : 'No. Site only.'],
              ['Reposted', s.repost?.done ? `Yes, ${when(s.repost.doneAt)}` : s.repost?.queued ? 'In the queue' : 'No'],
            ].map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))),
          ),
          h(
            'div',
            { class: 'btns' },
            s.status === 'pending' ? b('Approve', 'approve', `${s.id} is now showing.`, false) : null,
            ['pending', 'approved'].includes(s.status) ? b('Reject', 'reject', `${s.id} rejected. It is not showing.`) : null,
            canRepost && !s.repost?.queued && !s.repost?.done ? b('Add to repost queue', 'queue_repost', `${s.id} added to the repost queue.`) : null,
            canRepost && s.repost?.queued ? b('Mark as reposted', 'mark_reposted', `${s.id} marked as reposted.`) : null,
            canRepost && s.repost?.queued ? b('Take off the queue', 'unqueue_repost', `${s.id} taken off the queue.`) : null,
            !gone ? b('Remove and delete', 'remove', `${s.id} removed. The picture is deleted.`) : null,
          ),
        ),
      );
    });

    fill(
      h('h2', { text: 'Fan photos' }),
      h('p', { class: 'sub', text: 'Nothing shows until you approve it. Reposting is only offered when the fan ticked the second box. This site never posts to social media by itself: the queue is your to-do list.' }),
      message ? note(message, kind) : null,
      h(
        'div',
        { class: 'btns filters' },
        Object.keys(groups).map((k) => {
          const el = button(`${labels[k]} (${groups[k].length})`, () => {
            filter = k;
            draw();
          });
          el.setAttribute('aria-pressed', String(k === filter));
          return el;
        }),
      ),
      items.length ? items : note('Nothing here.'),
    );
  };
  draw();
}

// ---------- go ----------
void data;
if (token) signIn();
else showGate('');
