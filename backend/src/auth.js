import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { saveData } from "./database.js";

const scrypt = promisify(scryptCallback);
const sessions = new Map();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const cookieName = "ledgerly_session";
const roles = new Set(["admin", "accountant", "clerk", "read_only"]);
const loginFailures = new Map();

function audit(data, actor, action, target) {
  return {
    ...data,
    auditLog: [
      {
        id: randomBytes(16).toString("hex"),
        actor: actor ?? "system",
        action,
        target,
        timestamp: new Date().toISOString(),
      },
      ...(data.auditLog ?? []),
    ].slice(0, 1000),
  };
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new Error("Password must be between 12 and 256 characters.");
  }
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

async function passwordMatches(password, storedHash) {
  if (typeof password !== "string" || typeof storedHash !== "string") return false;
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex || !/^[\da-f]+$/i.test(saltHex) || !/^[\da-f]+$/i.test(keyHex)) {
    return false;
  }
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function ensureBootstrapAdmin(data) {
  if (data.users.length > 0) return data;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Configure ADMIN_EMAIL and ADMIN_PASSWORD in the project .env file to create the first administrator.",
    );
  }
  const user = {
    id: randomBytes(16).toString("hex"),
    email,
    name: "Administrator",
    role: "admin",
    passwordHash: await hashPassword(password),
    active: true,
    createdAt: new Date().toISOString(),
  };
  const nextData = audit({ ...data, users: [user] }, user.email, "user.bootstrap", user.id);
  await saveData(nextData);
  return nextData;
}

export async function createUser(data, { email, name, role, password }, actor) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
    throw new Error("Enter a name up to 100 characters.");
  }
  if (!roles.has(role) || role === "admin") {
    throw new Error("Choose Accountant, Sales/Purchasing Clerk, or Read-only.");
  }
  if (data.users.some((user) => user.email === normalizedEmail)) {
    throw new Error("A user with that email already exists.");
  }
  const user = {
    id: randomBytes(16).toString("hex"),
    email: normalizedEmail,
    name: name.trim(),
    role,
    passwordHash: await hashPassword(password),
    active: true,
    createdAt: new Date().toISOString(),
  };
  const nextData = audit({ ...data, users: [...data.users, user] }, actor, "user.created", user.id);
  await saveData(nextData);
  return { data: nextData, user: publicUser(user) };
}

export function publicUser(user) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure}`,
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
  );
}

function readSessionToken(request) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${cookieName}=`));
  return entry?.slice(cookieName.length + 1);
}

export async function login(request, response, data) {
  const address = request.socket.remoteAddress ?? "unknown";
  const failures = loginFailures.get(address);
  if (failures && failures.count >= 10 && failures.expiresAt > Date.now()) {
    return response.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
  }
  const email = typeof request.body.email === "string"
    ? request.body.email.trim().toLowerCase()
    : "";
  const user = data.users.find((candidate) => candidate.email === email && candidate.active);
  if (!user || !(await passwordMatches(request.body.password, user.passwordHash))) {
    const nextFailures = failures?.expiresAt > Date.now()
      ? { count: failures.count + 1, expiresAt: failures.expiresAt }
      : { count: 1, expiresAt: Date.now() + 15 * 60 * 1000 };
    loginFailures.set(address, nextFailures);
    return response.status(401).json({ error: "Email or password is incorrect." });
  }
  loginFailures.delete(address);
  const updatedData = audit(data, user.email, "user.login", user.id);
  await saveData(updatedData);
  Object.assign(data, updatedData);
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionLifetimeMs });
  setSessionCookie(response, token);
  return response.json({ user: publicUser(user) });
}

export function logout(request, response) {
  const token = readSessionToken(request);
  if (token) sessions.delete(token);
  clearSessionCookie(response);
  return response.status(204).end();
}

export function getSession(request, response, data) {
  const token = readSessionToken(request);
  const session = token && sessions.get(token);
  const user = session && session.expiresAt > Date.now()
    ? data.users.find((candidate) => candidate.id === session.userId && candidate.active)
    : undefined;
  if (!user) {
    if (token) sessions.delete(token);
    clearSessionCookie(response);
    return response.status(401).json({ error: "Sign in to continue." });
  }
  return response.json({ user: publicUser(user) });
}

export function authenticate(request, response, next) {
  const token = readSessionToken(request);
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return response.status(401).json({ error: "Sign in to continue." });
  }
  request.authUserId = session.userId;
  request.authUser = request.data?.users.find((user) => user.id === session.userId);
  if (!request.authUser?.active) {
    sessions.delete(token);
    return response.status(401).json({ error: "Sign in to continue." });
  }
  return next();
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    const user = request.data.users.find((candidate) => candidate.id === request.authUserId);
    if (!user?.active) return response.status(401).json({ error: "Sign in to continue." });
    if (!allowedRoles.includes(user.role)) {
      return response.status(403).json({ error: "Your role does not allow this action." });
    }
    request.authUser = user;
    return next();
  };
}

export function recordAudit(data, user, action, target) {
  return audit(data, user?.email ?? "system", action, target);
}
