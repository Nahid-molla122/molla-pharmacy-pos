import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const app = express();
const port = Number(process.env.PORT || 3001);
const cookieName = 'pharmacy_session';
const sessionDuration = 8 * 60 * 60 * 1000;
const roles = ['admin', 'user'];
const receiptTokenPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const defaultUnits = {
  single: ['piece', 'tablet', 'capsule', 'bottle', 'vial', 'ampoule', 'pen', 'tube', 'bag', 'cartridge'],
  pack: ['strip', 'box', 'pack', 'bottle', 'piece', 'vial', 'tube'],
};
const defaultQuickQuantityTypes = [
  { id: 'piece', label: 'Piece' },
  { id: 'strip', label: 'Strip' },
  { id: 'box', label: 'Box' },
  { id: 'singleItem', label: 'Single Item' },
];

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: roles, required: true, default: 'user' },
  active: { type: Boolean, default: true },
  isPrimaryAdmin: { type: Boolean, default: false },
}, { timestamps: true });

const dataSchema = new mongoose.Schema({
  _id: { type: String, default: 'pharmacy-data' },
  products: { type: [mongoose.Schema.Types.Mixed], default: [] },
  sales: { type: [mongoose.Schema.Types.Mixed], default: [] },
  reportSales: { type: [mongoose.Schema.Types.Mixed], default: [] },
  hiddenReportPeriods: { type: [String], default: [] },
  reportResets: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  units: { type: mongoose.Schema.Types.Mixed, default: () => structuredClone(defaultUnits) },
  quickQuantityTypes: { type: [mongoose.Schema.Types.Mixed], default: () => structuredClone(defaultQuickQuantityTypes) },
  nextBillNumber: { type: Number, default: 1 },
  revision: { type: Number, default: 0 },
}, { versionKey: false });

const User = mongoose.model('User', userSchema);
const PharmacyData = mongoose.model('PharmacyData', dataSchema);

app.disable('x-powered-by');
app.use(helmet());
if (process.env.FRONTEND_ORIGIN) {
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
}
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again later.' },
});
const receiptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many receipt requests. Try again later.' },
});

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, isPrimaryAdmin: user.isPrimaryAdmin };
}

function sendSession(res, user) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters.');
  const token = jwt.sign({ sub: user.id }, secret, { expiresIn: '8h' });
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: sessionDuration,
    path: '/api',
  });
}

async function authenticate(req, res, next) {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      return res.status(503).json({ error: 'Authentication is not configured on the server.' });
    }
    const token = req.cookies[cookieName];
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    const claims = jwt.verify(token, secret);
    const user = await User.findById(claims.sub);
    if (!user || !user.active) {
      res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api' });
      return res.status(401).json({ error: 'This account is unavailable. Contact an administrator.' });
    }
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api' });
      return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
    }
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
  next();
}

function requireMainAdmin(req, res, next) {
  if (req.user.role !== 'admin' || !req.user.isPrimaryAdmin) {
    return res.status(403).json({ error: 'Main administrator access is required.' });
  }
  next();
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

function validAccountPassword(value) {
  return typeof value === 'string' && value.length >= 4;
}

function validAccountIdentifier(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 254;
}

function hashAccountPassword(password) {
  const digest = createHash('sha256').update(password, 'utf8').digest('hex');
  return bcrypt.hash(digest, 12).then(hash => `sha256-bcrypt$${hash}`);
}

function verifyPassword(password, passwordHash) {
  if (passwordHash.startsWith('sha256-bcrypt$')) {
    const digest = createHash('sha256').update(password, 'utf8').digest('hex');
    return bcrypt.compare(digest, passwordHash.slice('sha256-bcrypt$'.length));
  }
  return bcrypt.compare(password, passwordHash);
}

function safeData(data) {
  return {
    products: data.products,
    sales: data.sales,
    reportSales: data.reportSales ?? data.sales,
    hiddenReportPeriods: data.hiddenReportPeriods ?? [],
    reportResets: data.reportResets ?? {},
    units: data.units,
    quickQuantityTypes: data.quickQuantityTypes,
    nextBillNumber: data.nextBillNumber,
  };
}

function validData(data) {
  return data && typeof data === 'object' &&
    Array.isArray(data.products) && Array.isArray(data.sales) &&
    data.sales.every(sale => sale && receiptTokenPattern.test(sale.receiptToken)) &&
    new Set(data.sales.map(sale => sale.receiptToken)).size === data.sales.length &&
    Array.isArray(data.reportSales) &&
    data.reportSales.every(sale => sale && typeof sale.id === 'string' && receiptTokenPattern.test(sale.receiptToken)) &&
    new Set(data.reportSales.map(sale => sale.id)).size === data.reportSales.length &&
    new Set(data.reportSales.map(sale => sale.receiptToken)).size === data.reportSales.length &&
    Array.isArray(data.hiddenReportPeriods) &&
    data.hiddenReportPeriods.every(period => /^(daily:\d{4}-\d{2}-\d{2}|monthly:\d{4}-\d{2})$/.test(period)) &&
    data.reportResets && typeof data.reportResets === 'object' && !Array.isArray(data.reportResets) &&
    Object.entries(data.reportResets).every(([period, resetAt]) =>
      /^(daily:\d{4}-\d{2}-\d{2}|monthly:\d{4}-\d{2})$/.test(period) &&
      typeof resetAt === 'string' && Number.isFinite(Date.parse(resetAt))) &&
    data.units && typeof data.units === 'object' &&
    Array.isArray(data.units.single) && Array.isArray(data.units.pack) &&
    Array.isArray(data.quickQuantityTypes) &&
    Number.isSafeInteger(data.nextBillNumber) && data.nextBillNumber > 0;
}

function sameEntityExists(list, entity, key) {
  return list.some(item => item && entity && item[key] === entity[key]);
}

function userCanUpdate(current, next) {
  if (!isDeepStrictEqual(current.products, next.products)) return false;
  if (next.sales.length < current.sales.length) return false;
  for (const sale of current.sales) {
    const replacement = next.sales.find(item => item?.id === sale?.id);
    if (!replacement) return false;
    const { receiptToken: currentToken, ...currentSale } = sale;
    const { receiptToken: nextToken, ...nextSale } = replacement;
    if (!isDeepStrictEqual(currentSale, nextSale) ||
        (currentToken ? currentToken !== nextToken : !receiptTokenPattern.test(nextToken || ''))) return false;
  }
  const currentReportIds = new Set(current.reportSales.map(sale => sale.id));
  const nextReportById = new Map(next.reportSales.map(sale => [sale.id, sale]));
  for (const sale of current.reportSales) {
    if (!isDeepStrictEqual(sale, nextReportById.get(sale.id))) return false;
  }
  const newSales = next.sales.filter(sale => !current.sales.some(currentSale => currentSale.id === sale.id));
  const newReportSales = next.reportSales.filter(sale => !currentReportIds.has(sale.id));
  const newSalesById = new Map(newSales.map(sale => [sale.id, sale]));
  if (newSales.length !== newReportSales.length ||
      newReportSales.some(sale => !isDeepStrictEqual(sale, newSalesById.get(sale.id)))) return false;
  if (!isDeepStrictEqual(current.hiddenReportPeriods, next.hiddenReportPeriods) ||
      !isDeepStrictEqual(current.reportResets ?? {}, next.reportResets)) return false;
  for (const unitGroup of ['single', 'pack']) {
    if (current.units[unitGroup].some(unit => !next.units[unitGroup].includes(unit))) return false;
  }
  if (current.quickQuantityTypes.some(type => !sameEntityExists(next.quickQuantityTypes, type, 'id'))) return false;
  return next.nextBillNumber >= current.nextBillNumber;
}

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!validAccountIdentifier(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'Enter your account identifier and password.' });
  }
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !user.active || !await verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email or password is incorrect, or the account is inactive.' });
  }
  sendSession(res, user);
  res.json({ user: publicUser(user) });
});

app.get('/api/receipts/:token', receiptLimiter, async (req, res) => {
  const { token } = req.params;
  if (!receiptTokenPattern.test(token)) return res.status(404).json({ error: 'Receipt not found.' });
  const data = await PharmacyData.findById('pharmacy-data').lean();
  const sale = data?.sales.find(item => item.receiptToken === token);
  if (!sale) return res.status(404).json({ error: 'Receipt not found.' });
  res.set('Cache-Control', 'no-store');
  res.json({
    sale: {
      bill: sale.bill,
      createdAt: sale.createdAt,
      items: sale.items,
      subtotal: sale.subtotal,
      itemDiscount: sale.itemDiscount,
      extraDiscount: sale.extraDiscount,
      total: sale.total,
      received: sale.received,
      change: sale.change,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api' });
  res.status(204).end();
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/users', authenticate, requireMainAdmin, async (_req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  res.json({ users: users.map(publicUser) });
});

app.post('/api/users', authenticate, requireMainAdmin, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
      !validAccountIdentifier(email) || !validAccountPassword(password) || !roles.includes(role)) {
    return res.status(400).json({ error: 'Provide a name, account identifier, password of at least 4 characters, and valid role.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ error: 'An account with that email already exists.' });
  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: await hashAccountPassword(password),
    role,
    active: true,
  });
  res.status(201).json({ user: publicUser(user) });
});

app.patch('/api/users/:id', authenticate, requireMainAdmin, async (req, res) => {
  const { name, email, password, role, active } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;
  if ((name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) ||
      (email !== undefined && !validAccountIdentifier(normalizedEmail)) ||
      (password !== undefined && !validAccountPassword(password)) ||
      (role !== undefined && !roles.includes(role)) || (active !== undefined && typeof active !== 'boolean') ||
      (name === undefined && email === undefined && password === undefined && role === undefined && active === undefined)) {
    return res.status(400).json({ error: 'Provide valid account details. Passwords must be at least 4 characters.' });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (normalizedEmail !== undefined && normalizedEmail !== user.email &&
      await User.exists({ email: normalizedEmail, _id: { $ne: user._id } })) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  if (user.id === req.user.id && (role === 'user' || active === false)) {
    return res.status(400).json({ error: 'You cannot deactivate or demote your own account.' });
  }
  if (user.role === 'admin' && (role === 'user' || active === false)) {
    const otherAdmins = await User.countDocuments({ role: 'admin', active: true, _id: { $ne: user._id } });
    if (!otherAdmins) return res.status(400).json({ error: 'At least one active administrator must remain.' });
  }
  if (name !== undefined) user.name = name.trim();
  if (normalizedEmail !== undefined) user.email = normalizedEmail;
  if (password !== undefined) user.passwordHash = await hashAccountPassword(password);
  if (role !== undefined) user.role = role;
  if (active !== undefined) user.active = active;
  await user.save();
  res.json({ user: publicUser(user) });
});

app.delete('/api/users/:id', authenticate, requireMainAdmin, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.isPrimaryAdmin) return res.status(400).json({ error: 'The main administrator account cannot be deleted.' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  if (user.role === 'admin') {
    const otherAdmins = await User.countDocuments({ role: 'admin', active: true, _id: { $ne: user._id } });
    if (!otherAdmins) return res.status(400).json({ error: 'At least one active administrator must remain.' });
  }
  await user.deleteOne();
  res.status(204).end();
});

app.get('/api/data', authenticate, async (_req, res) => {
  const data = await PharmacyData.findById('pharmacy-data').lean();
  res.json({
    data: safeData(data),
    version: data.revision,
  });
});

app.put('/api/data', authenticate, async (req, res) => {
  const { data: requested, version } = req.body || {};
  if (!validData(requested) || !Number.isSafeInteger(version) || version < 0) {
    return res.status(400).json({ error: 'The submitted pharmacy data is invalid.' });
  }
  const current = await PharmacyData.findById('pharmacy-data').lean();
  if (version !== current.revision) {
    return res.status(409).json({ error: 'Pharmacy data changed in another session. Refresh to load the latest data.' });
  }
  if (req.user.role !== 'admin' && !isDeepStrictEqual(current.products, requested.products)) {
    return res.status(403).json({ error: 'Only administrators can add, edit, or delete saved products.' });
  }
  if (req.user.role !== 'admin' && !userCanUpdate(current, requested)) {
    return res.status(403).json({ error: 'Users cannot save products or delete or alter existing records.' });
  }
  const updated = await PharmacyData.findOneAndUpdate(
    { _id: 'pharmacy-data', revision: version },
    { $set: safeData(requested), $inc: { revision: 1 } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) return res.status(409).json({ error: 'Pharmacy data changed in another session. Refresh to load the latest data.' });
  res.json({ version: updated.revision });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, _req, res, _next) => {
  if (error.code === 11000) return res.status(409).json({ error: 'That email address is already in use.' });
  if (error.name === 'CastError') return res.status(400).json({ error: 'Invalid account identifier.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Request body must be valid JSON.' });
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI must be set.');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters.');
  await mongoose.connect(process.env.MONGODB_URI);
  await PharmacyData.updateOne(
    { _id: 'pharmacy-data' },
    { $setOnInsert: { products: [], sales: [], reportSales: [], hiddenReportPeriods: [], reportResets: {}, units: defaultUnits, quickQuantityTypes: defaultQuickQuantityTypes, nextBillNumber: 1, revision: 0 } },
    { upsert: true },
  );
  const pharmacyData = await PharmacyData.findById('pharmacy-data').lean();
  if (!Array.isArray(pharmacyData.reportSales)) {
    await PharmacyData.updateOne(
      { _id: 'pharmacy-data' },
      { $set: { reportSales: pharmacyData.sales || [], hiddenReportPeriods: [] } },
    );
  } else if (!Array.isArray(pharmacyData.hiddenReportPeriods)) {
    await PharmacyData.updateOne(
      { _id: 'pharmacy-data' },
      { $set: { hiddenReportPeriods: [] } },
    );
  }
  const activeAdminExists = await User.exists({ role: 'admin', active: true });
  if (!activeAdminExists) {
    const { BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: password } = process.env;
    if (!validEmail(email) || !validPassword(password)) {
      throw new Error('No active administrator exists. Set BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters.');
    }
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    const admin = existing || await User.create({
      name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator',
      email: email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      role: 'admin',
      active: true,
    });
    if (!admin.active || admin.role !== 'admin') throw new Error('Bootstrap email belongs to an inactive or non-admin account.');
    console.info('Created initial administrator account from bootstrap environment variables.');
  }
  if (!await User.exists({ isPrimaryAdmin: true }) && validEmail(process.env.BOOTSTRAP_ADMIN_EMAIL)) {
    await User.updateOne(
      { email: process.env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase(), role: 'admin' },
      { $set: { isPrimaryAdmin: true } },
    );
  }
  app.listen(port, () => console.info(`Pharmacy API listening on port ${port}`));
}

start().catch(async error => {
  console.error(`Unable to start pharmacy API: ${error.message}`);
  await mongoose.disconnect();
  process.exitCode = 1;
});
