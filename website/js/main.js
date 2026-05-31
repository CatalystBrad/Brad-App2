/* =========================================================
   Woolacombe Bay Retreats — interactivity
   ========================================================= */

// --- Property data -------------------------------------------------
const cabins = [
  {
    name: 'Driftwood Lodge',
    tag: 'Hot Tub',
    sleeps: 4,
    beds: '2 bedrooms',
    price: 145,
    desc: 'A snug two-bedroom cedar cabin with private hot tub and a sun-trap deck overlooking rolling Devon hills.',
    feats: ['Private hot tub', 'Wood burner', 'Dog friendly', 'WiFi'],
    img: 'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=900&q=80'
  },
  {
    name: 'Seabreeze Cabin',
    tag: 'Sea Glimpse',
    sleeps: 6,
    beds: '3 bedrooms',
    price: 189,
    desc: 'Spacious family lodge with vaulted ceilings, a modern open-plan kitchen and glimpses of the bay from the master suite.',
    feats: ['Sea glimpse', 'Hot tub', 'Open-plan living', 'Parking'],
    img: 'https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=900&q=80'
  },
  {
    name: 'Foxglove Retreat',
    tag: 'Couples',
    sleeps: 2,
    beds: '1 bedroom',
    price: 119,
    desc: 'A romantic one-bedroom hideaway tucked among the trees — perfect for a cosy couples\' escape with a private firepit.',
    feats: ['Firepit', 'Wood burner', 'Romantic', 'WiFi'],
    img: 'https://images.unsplash.com/photo-1483721310020-03333e577078?auto=format&fit=crop&w=900&q=80'
  }
];

const caravans = [
  {
    name: 'Bayview 6-Berth',
    tag: 'Family',
    sleeps: 6,
    beds: '2 bedrooms',
    price: 79,
    desc: 'Bright and roomy six-berth static caravan with decked veranda, ideal for families exploring the North Devon coast.',
    feats: ['Decking', 'Dog friendly', 'Parking', 'WiFi'],
    img: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&w=900&q=80'
  },
  {
    name: 'Coastal Comfort',
    tag: 'Great Value',
    sleeps: 4,
    beds: '2 bedrooms',
    price: 65,
    desc: 'Comfortable and well-equipped four-berth van on a quiet corner of the park, footsteps from the coast path.',
    feats: ['Quiet plot', 'Central heating', 'Parking', 'WiFi'],
    img: 'https://images.unsplash.com/photo-1469796466635-455ede028aca?auto=format&fit=crop&w=900&q=80'
  },
  {
    name: 'Sandpiper Deluxe',
    tag: 'Premium',
    sleeps: 8,
    beds: '3 bedrooms',
    price: 99,
    desc: 'Our largest caravan — a premium eight-berth with two bathrooms and a wraparound deck for big family gatherings.',
    feats: ['8 berth', '2 bathrooms', 'Wraparound deck', 'WiFi'],
    img: 'https://images.unsplash.com/photo-1533873984035-25970ab07461?auto=format&fit=crop&w=900&q=80'
  }
];

// --- Render cards --------------------------------------------------
function cardHTML(p) {
  const feats = p.feats.map(f => `<li>${f}</li>`).join('');
  return `
    <article class="card">
      <div class="card-img" style="background-image:url('${p.img}')">
        <span class="card-tag">${p.tag}</span>
      </div>
      <div class="card-body">
        <h3>${p.name}</h3>
        <p class="card-meta">Sleeps ${p.sleeps} · ${p.beds}</p>
        <p class="card-desc">${p.desc}</p>
        <ul class="card-feats">${feats}</ul>
        <div class="card-foot">
          <span class="price">£${p.price} <small>/ night</small></span>
          <a href="#book" class="btn btn-primary" data-property="${p.name}">Enquire</a>
        </div>
      </div>
    </article>`;
}

function render(targetId, list) {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = list.map(cardHTML).join('');
}

render('cabin-cards', cabins);
render('caravan-cards', caravans);

// --- Mobile nav toggle ---------------------------------------------
const toggle = document.querySelector('.nav-toggle');
const menu = document.getElementById('nav-menu');
if (toggle && menu) {
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// --- Prefill property in form when "Enquire" clicked ---------------
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-property]');
  if (!link) return;
  const name = link.getAttribute('data-property');
  const isCabin = cabins.some(c => c.name === name);
  const select = document.querySelector('select[name="property"]');
  const msg = document.querySelector('textarea[name="message"]');
  if (select) select.value = isCabin ? 'cabin' : 'caravan';
  if (msg && !msg.value) msg.value = `I'd like to enquire about ${name}.`;
});

// --- Booking form handling -----------------------------------------
const form = document.getElementById('booking-form');
const status = document.getElementById('form-status');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    status.className = 'form-status';
    const data = new FormData(form);
    const arrive = data.get('arrive');
    const depart = data.get('depart');

    if (!data.get('name') || !data.get('email') || !arrive || !depart) {
      status.textContent = 'Please complete the required fields.';
      status.classList.add('err');
      return;
    }
    if (new Date(depart) <= new Date(arrive)) {
      status.textContent = 'Your departure date must be after your arrival date.';
      status.classList.add('err');
      return;
    }

    // No backend in this static build — confirm receipt to the guest.
    status.textContent = `Thank you, ${data.get('name')}! We'll email you availability for ${arrive} → ${depart} shortly.`;
    status.classList.add('ok');
    form.reset();
  });
}

// --- Footer year ---------------------------------------------------
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();
