const state = {
  user: null,
  centers: [],
  accounts: [],
  packages: [],
  queue: [],
  activePackageId: null,
  map: null,
  routeLayer: null,
};

const portals = {
  client: document.getElementById('client-portal'),
  employee: document.getElementById('admin-portal'),
  shipper: document.getElementById('shipper-portal'),
};

const loginStatus = document.getElementById('login-status');
const logoutBtn = document.getElementById('logout-btn');
const loginBtn = document.getElementById('login-btn');

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function setStatus(message) {
  loginStatus.textContent = message;
}

function togglePortals(role) {
  Object.entries(portals).forEach(([key, element]) => {
    element.classList.toggle('active', key === role);
  });
}

function updateMetrics() {
  document.getElementById('metric-total').textContent = state.packages.length;
  document.getElementById('metric-centers').textContent = state.centers.length;
}

function tagForStatus(status) {
  if (status === 'Delivered') return 'delivered';
  if (status === 'In Transit') return 'transit';
  return 'pending';
}

function renderClientListings() {
  const container = document.getElementById('client-listings');
  container.innerHTML = '';
  state.packages.forEach((pkg) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">
        <h4>${pkg.sender}</h4>
        <span class="tag ${tagForStatus(pkg.status)}">${pkg.status}</span>
      </div>
      <p><strong>Drop-off:</strong> ${pkg.dropoff}</p>
      <p><strong>Address:</strong> ${pkg.address}</p>
      <p><strong>Size:</strong> ${pkg.size} · <strong>Weight:</strong> ${pkg.weight}</p>
    `;
    container.appendChild(card);
  });
}

function renderCenters() {
  const list = document.getElementById('center-list');
  list.innerHTML = '';
  state.centers.forEach((center) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">
        <h4>${center.name}</h4>
        <button data-id="${center.id}" class="ghost">Delete</button>
      </div>
      <p>${center.location}</p>
    `;
    card.querySelector('button').addEventListener('click', async () => {
      await api(`/api/centers/${center.id}`, { method: 'DELETE' });
      await loadEmployeeData();
    });
    list.appendChild(card);
  });

  const select = document.getElementById('account-center');
  select.innerHTML = '';
  state.centers.forEach((center) => {
    const option = document.createElement('option');
    option.value = center.id;
    option.textContent = center.name;
    select.appendChild(option);
  });
}

function renderAccounts() {
  const list = document.getElementById('account-list');
  list.innerHTML = '';
  state.accounts.forEach((account) => {
    const centerName = state.centers.find((center) => center.id === account.centerId)?.name || 'Unassigned';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">
        <h4>${account.name}</h4>
        <span class="pill">${account.role}</span>
      </div>
      <p>${centerName}</p>
    `;
    list.appendChild(card);
  });
}

function renderPackageTable(filtered = state.packages) {
  const table = document.getElementById('package-table');
  table.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'table-row header';
  header.innerHTML = '<div>Sender</div><div>Address</div><div>Status</div><div>Center</div>';
  table.appendChild(header);

  filtered.forEach((pkg) => {
    const centerName = state.centers.find((center) => center.id === pkg.centerId)?.name || 'Unassigned';
    const row = document.createElement('div');
    row.className = 'table-row';
    row.innerHTML = `
      <div>${pkg.sender}</div>
      <div>${pkg.address}</div>
      <div>${pkg.status}</div>
      <div>${centerName}</div>
    `;
    table.appendChild(row);
  });
}

function renderShipperQueue() {
  const list = document.getElementById('shipper-queue');
  list.innerHTML = '';
  state.queue.filter((pkg) => pkg.status !== 'Delivered').forEach((pkg) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">
        <h4>${pkg.sender}</h4>
        <span class="tag ${tagForStatus(pkg.status)}">${pkg.status}</span>
      </div>
      <p>${pkg.address}</p>
      <button data-id="${pkg.id}" class="full">Claim</button>
    `;
    card.querySelector('button').addEventListener('click', async () => {
      await api(`/api/shipper/claim/${pkg.id}`, { method: 'POST' });
      state.activePackageId = pkg.id;
      await loadShipperData();
      focusRoute(pkg);
    });
    list.appendChild(card);
  });
}

function updateShipperStats() {
  const transit = state.queue.filter((pkg) => pkg.status === 'In Transit').length;
  const delivered = state.queue.filter((pkg) => pkg.status === 'Delivered').length;
  document.getElementById('stat-transit').textContent = transit;
  document.getElementById('stat-delivered').textContent = delivered;
}

function ensureMap() {
  if (state.map) return;
  state.map = L.map('map').setView([40.7128, -74.006], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(state.map);
}

function focusRoute(pkg) {
  if (!pkg || !state.map) return;
  if (state.routeLayer) {
    state.map.removeLayer(state.routeLayer);
  }
  const center = state.centers.find((item) => item.id === pkg.centerId);
  const route = [
    [center?.lat || 40.7128, center?.lng || -74.006],
    [pkg.destLat || 40.718, pkg.destLng || -74.01],
  ];
  state.routeLayer = L.polyline(route, { color: '#3b82f6' }).addTo(state.map);
  state.map.fitBounds(state.routeLayer.getBounds(), { padding: [30, 30] });
}

async function loadClientData() {
  const [centerData, packageData] = await Promise.all([
    api('/api/centers'),
    api('/api/packages'),
  ]);
  state.centers = centerData.centers;
  state.packages = packageData.packages;
  renderClientListings();
  updateMetrics();
}

async function loadEmployeeData() {
  const [centerData, accountData, packageData] = await Promise.all([
    api('/api/centers'),
    api('/api/accounts'),
    api('/api/packages'),
  ]);
  state.centers = centerData.centers;
  state.accounts = accountData.accounts;
  state.packages = packageData.packages;
  renderCenters();
  renderAccounts();
  renderPackageTable();
  updateMetrics();
}

async function loadShipperData() {
  const [centerData, queueData] = await Promise.all([
    api('/api/centers'),
    api('/api/shipper/queue'),
  ]);
  state.centers = centerData.centers;
  state.queue = queueData.packages;
  renderShipperQueue();
  updateShipperStats();
  updateMetrics();
}

async function initSession() {
  try {
    const data = await api('/api/me');
    state.user = data.user;
    setStatus(`Online as ${state.user.name} (${state.user.role})`);
    logoutBtn.hidden = false;
    togglePortals(state.user.role);
    ensureMap();
    if (state.user.role === 'client') {
      await loadClientData();
    }
    if (state.user.role === 'employee') {
      await loadEmployeeData();
    }
    if (state.user.role === 'shipper') {
      await loadShipperData();
    }
  } catch (error) {
    setStatus('Offline');
    togglePortals(null);
  }
}

loginBtn.addEventListener('click', async () => {
  const name = document.getElementById('login-name').value.trim();
  const role = document.getElementById('login-role').value;
  if (!name) {
    setStatus('Enter a name to continue.');
    return;
  }
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ name, role }) });
    await initSession();
  } catch (error) {
    setStatus(error.message);
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  logoutBtn.hidden = true;
  setStatus('Offline');
  togglePortals(null);
});

const listingForm = document.getElementById('listing-form');
listingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(listingForm);
  const payload = Object.fromEntries(formData.entries());
  await api('/api/packages', { method: 'POST', body: JSON.stringify(payload) });
  listingForm.reset();
  await loadClientData();
});

const centerForm = document.getElementById('center-form');
centerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(centerForm).entries());
  await api('/api/centers', { method: 'POST', body: JSON.stringify(payload) });
  centerForm.reset();
  await loadEmployeeData();
});

const accountForm = document.getElementById('account-form');
accountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(accountForm).entries());
  await api('/api/accounts', { method: 'POST', body: JSON.stringify(payload) });
  accountForm.reset();
  await loadEmployeeData();
});

const packageSearch = document.getElementById('package-search');
packageSearch.addEventListener('input', () => {
  const term = packageSearch.value.toLowerCase();
  const filtered = state.packages.filter((pkg) =>
    pkg.sender.toLowerCase().includes(term) || pkg.address.toLowerCase().includes(term),
  );
  renderPackageTable(filtered);
});

const markDelivered = document.getElementById('mark-delivered');
markDelivered.addEventListener('click', async () => {
  if (!state.activePackageId) return;
  await api(`/api/shipper/deliver/${state.activePackageId}`, { method: 'POST' });
  state.activePackageId = null;
  await loadShipperData();
});

initSession();
