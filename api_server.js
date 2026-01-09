const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const roles = ['client', 'employee', 'shipper'];
const centers = [
  {
    id: crypto.randomUUID(),
    name: 'East Harbor Hub',
    location: '40.7128, -74.0060',
    lat: 40.7128,
    lng: -74.006,
  },
];
const accounts = [
  {
    id: crypto.randomUUID(),
    name: 'Nova Admin',
    role: 'employee',
    centerId: centers[0].id,
  },
  {
    id: crypto.randomUUID(),
    name: 'Riley Shipper',
    role: 'shipper',
    centerId: centers[0].id,
  },
];
const packages = [];

function createDestination(center) {
  const latOffset = (Math.random() - 0.5) * 0.08;
  const lngOffset = (Math.random() - 0.5) * 0.08;
  return {
    destLat: Number((center.lat + latOffset).toFixed(6)),
    destLng: Number((center.lng + lngOffset).toFixed(6)),
  };
}

function signSession(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

function setSessionCookie(res, token) {
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie('session');
}

function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

function requireRole(allowed) {
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

app.post('/api/login', (req, res) => {
  const { name, role } = req.body;
  if (!name || !roles.includes(role)) {
    return res.status(400).json({ error: 'Name and role required.' });
  }

  let account = accounts.find((entry) => entry.name === name && entry.role === role);
  if (!account && (role === 'employee' || role === 'shipper')) {
    account = {
      id: crypto.randomUUID(),
      name,
      role,
      centerId: centers[0]?.id || null,
    };
    accounts.push(account);
  }

  const token = signSession({
    name,
    role,
    accountId: account?.id || null,
    centerId: account?.centerId || centers[0]?.id || null,
  });
  setSessionCookie(res, token);
  return res.json({ ok: true, user: { name, role, centerId: account?.centerId || null } });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/centers', requireAuth, requireRole(['employee', 'shipper', 'client']), (req, res) => {
  res.json({ centers });
});

app.post('/api/centers', requireAuth, requireRole(['employee']), (req, res) => {
  const { name, location } = req.body;
  if (!name || !location) {
    return res.status(400).json({ error: 'Name and location required.' });
  }
  const [lat, lng] = location.split(',').map((value) => Number(value.trim()));
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'Location must be "lat, lng".' });
  }
  const center = { id: crypto.randomUUID(), name, location, lat, lng };
  centers.push(center);
  res.json({ center });
});

app.delete('/api/centers/:id', requireAuth, requireRole(['employee']), (req, res) => {
  const index = centers.findIndex((center) => center.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Center not found.' });
  }
  centers.splice(index, 1);
  res.json({ ok: true });
});

app.get('/api/accounts', requireAuth, requireRole(['employee']), (req, res) => {
  res.json({ accounts });
});

app.post('/api/accounts', requireAuth, requireRole(['employee']), (req, res) => {
  const { name, role, centerId } = req.body;
  if (!name || !roles.includes(role)) {
    return res.status(400).json({ error: 'Name and valid role required.' });
  }
  const account = {
    id: crypto.randomUUID(),
    name,
    role,
    centerId: centerId || centers[0]?.id || null,
  };
  accounts.push(account);
  res.json({ account });
});

app.get('/api/packages', requireAuth, requireRole(['employee', 'client']), (req, res) => {
  res.json({ packages });
});

app.post('/api/packages', requireAuth, requireRole(['client']), (req, res) => {
  const { size, weight, dropoff, sender, address } = req.body;
  if (!size || !weight || !dropoff || !sender || !address) {
    return res.status(400).json({ error: 'All fields required.' });
  }
  const center = centers[0];
  const destination = center ? createDestination(center) : { destLat: null, destLng: null };
  const pkg = {
    id: crypto.randomUUID(),
    size,
    weight,
    dropoff,
    sender,
    address,
    status: 'Pending',
    centerId: center?.id || null,
    shipperId: null,
    createdAt: Date.now(),
    ...destination,
  };
  packages.unshift(pkg);
  res.json({ package: pkg });
});

app.get('/api/shipper/queue', requireAuth, requireRole(['shipper']), (req, res) => {
  const queue = packages.filter((pkg) => pkg.centerId === req.user.centerId);
  res.json({ packages: queue });
});

app.post('/api/shipper/claim/:id', requireAuth, requireRole(['shipper']), (req, res) => {
  const pkg = packages.find((item) => item.id === req.params.id);
  if (!pkg) {
    return res.status(404).json({ error: 'Package not found.' });
  }
  pkg.status = 'In Transit';
  pkg.shipperId = req.user.accountId;
  res.json({ package: pkg });
});

app.post('/api/shipper/deliver/:id', requireAuth, requireRole(['shipper']), (req, res) => {
  const pkg = packages.find((item) => item.id === req.params.id);
  if (!pkg) {
    return res.status(404).json({ error: 'Package not found.' });
  }
  pkg.status = 'Delivered';
  pkg.deliveredAt = Date.now();
  res.json({ package: pkg });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
