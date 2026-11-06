/**
 * DEMO SANDBOX booking website — a local fixture for exercising the test engine end to end.
 * It is not a real booking system: bookings live in memory and no payment is processed.
 *
 * Run standalone for manual trials:  npx tsx apps/api/test/fixtures/sandbox-site.ts  (listens on :4500)
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const HOTELS = [
  { id: '1', name: 'Marina Sandbox Hotel', city: 'Dubai', rooms: [{ code: 'DLX', name: 'Deluxe King', rate: 820 }, { code: 'STE', name: 'Junior Suite', rate: 1490 }] },
  { id: '2', name: 'Creek Test Residence', city: 'Dubai', rooms: [{ code: 'STD', name: 'Standard Twin', rate: 410 }] },
];

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Sandbox Booking</title>
<script src="https://analytics.example.com/tracker.js"></script>
<style>body{font-family:system-ui;margin:24px;max-width:720px}.error{color:#b42318}.card{border:1px solid #ddd;padding:12px;margin:8px 0}</style></head>
<body><div id="sandbox-banner">SANDBOX — no real bookings</div>${body}</body></html>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function startSandboxSite(port = 0): Promise<{ url: string; server: Server; bookings: Map<string, { status: string; guest: string }> }> {
  const bookings = new Map<string, { status: string; guest: string }>();
  let seq = 1000;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(html);
    };
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const form = new URLSearchParams(body);
      if (req.method === 'GET' && url.pathname === '/') {
        return send(200, page('Search', `<h1>Find a hotel</h1><form action="/search" method="get">
          <input id="destination" name="destination" placeholder="Destination"><input id="checkin" name="checkin" type="date"><input id="checkout" name="checkout" type="date">
          <button id="search" type="submit">Search</button></form>`));
      }
      if (req.method === 'GET' && url.pathname === '/search') {
        const dest = url.searchParams.get('destination') ?? '';
        const ci = url.searchParams.get('checkin') ?? '';
        const co = url.searchParams.get('checkout') ?? '';
        if (!dest || !ci || !co) return send(400, page('Search', '<p class="error" id="search-error">Destination and dates are required</p>'));
        if (co <= ci) return send(200, page('Search', '<p class="error" id="search-error">Check-out must be after check-in</p>'));
        const found = HOTELS.filter((h) => h.city.toLowerCase() === dest.toLowerCase());
        return send(200, page('Results', found.length
          ? `<h1 id="results-title">${found.length} hotels in ${esc(dest)}</h1>${found.map((h) => `<div class="card hotel-card"><h2>${h.name}</h2><a class="view" href="/hotel/${h.id}?checkin=${ci}&checkout=${co}">View rooms</a></div>`).join('')}`
          : `<p id="no-results">No hotels available in ${esc(dest)}</p>`));
      }
      const hotel = /^\/hotel\/(\d+)$/.exec(url.pathname);
      if (req.method === 'GET' && hotel) {
        const h = HOTELS.find((x) => x.id === hotel[1]);
        if (!h) return send(404, page('Not found', '<p>Hotel not found</p>'));
        return send(200, page(h.name, `<h1>${h.name}</h1>${h.rooms.map((r) => `<div class="card room" data-code="${r.code}"><b>${r.name}</b> <span class="rate">AED ${r.rate}</span>
          <a class="select-rate" href="/book?hotel=${h.id}&room=${r.code}&checkin=${url.searchParams.get('checkin')}&checkout=${url.searchParams.get('checkout')}">Select</a></div>`).join('')}
          <p id="policy">Free cancellation until 48 hours before arrival. Later cancellations are charged one night.</p>`));
      }
      if (req.method === 'GET' && url.pathname === '/book') {
        return send(200, page('Guest details', `<h1>Guest details</h1><form id="guest-form" method="post" action="/book?${url.searchParams}" novalidate>
          <input id="first" name="first" placeholder="First name"><input id="last" name="last" placeholder="Last name"><input id="email" name="email" placeholder="Email">
          <input id="card" name="card" placeholder="Card number (test mode)"><button id="confirm" type="submit">Confirm booking</button><p class="error" id="form-error" hidden></p></form>
          <script>document.getElementById('guest-form').addEventListener('submit',function(e){var em=document.getElementById('email').value;var err=document.getElementById('form-error');
          if(!document.getElementById('first').value||!document.getElementById('last').value){e.preventDefault();err.hidden=false;err.textContent='Guest name is required';return}
          if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em)){e.preventDefault();err.hidden=false;err.textContent='Enter a valid email address';}});</script>`));
      }
      if (req.method === 'POST' && url.pathname === '/book') {
        const card = (form.get('card') ?? '').replace(/\D/g, '');
        if (card !== '4242424242424242') return send(402, page('Payment', '<p class="error" id="payment-error">Sandbox accepts only test card 4242 4242 4242 4242</p>'));
        const ref = `SBX-${++seq}`;
        bookings.set(ref, { status: 'CONFIRMED', guest: `${form.get('first')} ${form.get('last')}` });
        return send(303, '', { location: `/confirmation/${ref}` });
      }
      const conf = /^\/confirmation\/(SBX-\d+)$/.exec(url.pathname);
      if (req.method === 'GET' && conf) {
        const b = bookings.get(conf[1]!);
        if (!b) return send(404, page('Not found', '<p>Booking not found</p>'));
        return send(200, page('Confirmed', `<h1>Booking confirmed</h1><p>Reference <span id="booking-ref">${conf[1]}</span></p><p id="status">${b.status}</p><a id="manage" href="/manage/${conf[1]}">Manage booking</a>`));
      }
      const manage = /^\/manage\/(SBX-\d+)$/.exec(url.pathname);
      if (manage) {
        const b = bookings.get(manage[1]!);
        if (!b) return send(404, page('Not found', '<p>Booking not found</p>'));
        if (req.method === 'POST') {
          b.status = 'CANCELLED';
          return send(303, '', { location: `/manage/${manage[1]}` });
        }
        return send(200, page('Manage', `<h1>Booking ${manage[1]}</h1><p id="status">${b.status}</p>${b.status === 'CANCELLED' ? '<p id="refund">Refund: full amount (free cancellation window)</p>' : `<form method="post"><button id="cancel" type="submit">Cancel booking</button></form>`}`));
      }
      if (url.pathname === '/broken') return send(500, page('Error', '<p>Internal error</p>'));
      send(404, page('Not found', '<p>Not found</p>'));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, bookings })));
}

/** Ready-made step configurations for the demo sandbox (also shown in the UI as examples). */
export const SANDBOX_SCENARIOS: Record<'search' | 'bookAndCancel', { variables: Record<string, string>; steps: Record<string, unknown>[] }> = {
  search: {
    variables: { city: 'Dubai' },
    steps: [
      { action: 'goto', path: '/' },
      { action: 'fill', selector: '#destination', value: '{{city}}' },
      { action: 'fill', selector: '#checkin', value: '{{date:+30}}' },
      { action: 'fill', selector: '#checkout', value: '{{date:+33}}' },
      { action: 'click', selector: '#search' },
      { action: 'expectCount', selector: '.hotel-card', min: 1 },
      { action: 'screenshot', name: 'results' },
    ],
  },
  bookAndCancel: {
    variables: {},
    steps: [
      { action: 'goto', path: '/search?destination=Dubai&checkin={{date:+40}}&checkout={{date:+42}}' },
      { action: 'click', selector: '.hotel-card .view' },
      { action: 'expectText', selector: '#policy', contains: 'Free cancellation' },
      { action: 'click', selector: '.room[data-code=DLX] .select-rate' },
      { action: 'fill', selector: '#first', value: 'Test' },
      { action: 'fill', selector: '#last', value: 'Guest' },
      { action: 'fill', selector: '#email', value: '{{secret.guestEmail}}' },
      { action: 'fill', selector: '#card', value: '4242 4242 4242 4242' },
      { action: 'click', selector: '#confirm' },
      { action: 'extract', selector: '#booking-ref', as: 'ref' },
      { action: 'expectText', selector: '#status', contains: 'CONFIRMED' },
      { action: 'goto', path: '/manage/{{extracted.ref}}' },
      { action: 'click', selector: '#cancel' },
      { action: 'expectText', selector: '#status', contains: 'CANCELLED' },
      { action: 'expectVisible', selector: '#refund' },
    ],
  },
};

if (process.argv[1]?.endsWith('sandbox-site.ts')) {
  void startSandboxSite(Number(process.env.PORT ?? 4500)).then(({ url }) => console.warn(`DEMO sandbox booking site on ${url}`));
}
