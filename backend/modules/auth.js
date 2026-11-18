'use strict';

const crypto = require('node:crypto');
const { db } = require('../shared/database');
const { failure } = require('../shared/http');

const COOKIE = 'cc_session';
const MAX_AGE = 12 * 60 * 60;
const failed = new Map();
const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');
const hash = (password, salt) => crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');

function isConfigured() {
  return db.prepare('SELECT COUNT(*) AS total FROM users').get().total === 2;
}

function setPassword(role, password) {
  if (!['pca', 'fabrica'].includes(role)) failure(422, 'Perfil desconhecido.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) failure(422, 'A palavra-passe deve ter entre 12 e 200 caracteres.');
  const salt = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO users(role,salt,password_hash) VALUES(?,?,?) ON CONFLICT(role) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash')
    .run(role, salt, hash(password, salt));
  db.prepare('DELETE FROM sessions WHERE role=?').run(role);
}

function login(role, password, remoteAddress) {
  const key = remoteAddress || 'local';
  const attempt = failed.get(key);
  if (attempt && attempt.until > Date.now()) failure(429, 'Demasiadas tentativas. Aguarda 15 minutos.');
  const user = typeof role === 'string' ? db.prepare('SELECT * FROM users WHERE role=?').get(role) : null;
  const valid = typeof password === 'string' && user && password.length <= 200 &&
    crypto.timingSafeEqual(Buffer.from(hash(password, user.salt), 'hex'), Buffer.from(user.password_hash, 'hex'));
  if (!valid) {
    const count = (attempt && attempt.until > 0 ? attempt.count : 0) + 1;
    failed.set(key, { count, until: count >= 8 ? Date.now() + 15 * 60 * 1000 : 0 });
    failure(401, 'Perfil ou palavra-passe incorrectos.');
  }
  failed.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + MAX_AGE * 1000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions(token_hash,role,expires_at) VALUES(?,?,?)').run(digest(token), role, expiresAt);
  return { role, token };
}

function session(req) {
  const raw = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  const token = raw && raw.slice(COOKIE.length + 1);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = db.prepare('SELECT role FROM sessions WHERE token_hash=? AND expires_at > ?').get(digest(token), new Date().toISOString());
  return row ? { role: row.role, token } : null;
}

function logout(req) {
  const current = session(req);
  if (current) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(current.token));
}

function requireRole(req, role) {
  const current = session(req);
  if (!current) failure(401, 'Sessão expirada. Volta a entrar.');
  if (role && current.role !== role) failure(403, 'Este perfil não pode alterar nem consultar estes registos.');
  return current;
}

function cookie(token, req) {
  const secure = process.env.CONTACARTA_SECURE_COOKIE === '1' || req.socket.encrypted;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
module.exports = { isConfigured, setPassword, login, session, logout, requireRole, cookie, clearCookie };
