const { randomBytes } = require('node:crypto');

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';
const HOLIDAYS_API = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records';

const dayKey = value => String(value || '').slice(0, 10);
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g, ' ').trim();

function classifyEvent(title) {
  const text = normalize(title);
  if (/\babsen(?:t|ce)\b/.test(text)) return 'absence';
  if (/\brdv\b|\brendez vous\b|\bmedecin\b|\bdentiste\b/.test(text)) return 'appointment';
  if (/\bsoiree\b|\brestaurant\b|\banniversaire\b|\bconcert\b|\bsortie\b/.test(text)) return 'busy-evening';
  if (/\bconge?s?\b|\bvacances?\b/.test(text)) return 'leave';
  if (/\br apres midi\b/.test(text)) return 'return-afternoon';
  if (/\bapres midi\b/.test(text)) return 'afternoon';
  if (/\br matin\b/.test(text)) return 'return-morning';
  if (/\bmatin\b/.test(text)) return 'morning';
  if (/\bnuit\b/.test(text)) return 'night';
  if (/\bcentre\b/.test(text)) return 'centre';
  return null;
}

function expandEvents(events = []) {
  const result = [];
  for (const event of events) {
    const start = dayKey(event.start?.date || event.start?.dateTime);
    const rawEnd = dayKey(event.end?.date || event.end?.dateTime) || start;
    if (!start) continue;
    const end = new Date(`${rawEnd}T12:00:00`);
    if (event.end?.date) end.setDate(end.getDate() - 1);
    const startTime = event.start?.dateTime?.match(/T(\d{2}):(\d{2})/)?.slice(1).join(':') || null; const endTime = event.end?.dateTime?.match(/T(\d{2}):(\d{2})/)?.slice(1).join(':') || null; const type = classifyEvent(event.summary) || (event.start?.dateTime ? 'appointment' : null);
    for (const date = new Date(`${start}T12:00:00`); date <= end; date.setDate(date.getDate() + 1)) result.push({ id: event.id, date: dayKey(date.toISOString()), title: event.summary || '', type, startTime, endTime });
  }
  return result;
}

function googleConfig(env = process.env) {
  return { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '', redirectUri: env.GOOGLE_REDIRECT_URI || '' };
}

function authorizationUrl(state, env) {
  const config = googleConfig(env); if (!config.clientId || !config.redirectUri) throw new Error('Google Calendar n’est pas configuré sur le serveur.');
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/calendar.readonly', access_type: 'offline', prompt: 'consent', state });
  return `${GOOGLE_AUTH}?${params}`;
}

async function tokenRequest(params, fetchImpl = fetch, env) {
  const config = googleConfig(env); const response = await fetchImpl(GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }) });
  if (!response.ok) throw new Error(`Google OAuth a répondu ${response.status}.`); return response.json();
}

async function accessToken(calendar, fetchImpl = fetch, env) {
  if (calendar.accessToken && Number(calendar.expiresAt || 0) > Date.now() + 60_000) return calendar.accessToken;
  if (!calendar.refreshToken) throw new Error('Reconnectez Google Calendar.');
  const token = await tokenRequest({ refresh_token: calendar.refreshToken, grant_type: 'refresh_token' }, fetchImpl, env);
  calendar.accessToken = token.access_token; calendar.expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000; return calendar.accessToken;
}

async function googleGet(path, calendar, fetchImpl = fetch, env) {
  const token = await accessToken(calendar, fetchImpl, env); const response = await fetchImpl(`${GOOGLE_API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Calendar a répondu ${response.status}.`); return response.json();
}

async function fetchCalendars(calendar, fetchImpl = fetch, env) { const data = await googleGet('/users/me/calendarList?minAccessRole=reader', calendar, fetchImpl, env); return (data.items || []).map(item => ({ id: item.id, name: item.summary, primary: Boolean(item.primary) })); }
async function fetchEvents(calendar, startDate, endDate, fetchImpl = fetch, env) { const end = new Date(`${endDate}T12:00:00`); end.setDate(end.getDate() + 1); const params = new URLSearchParams({ timeMin: `${startDate}T00:00:00Z`, timeMax: `${dayKey(end.toISOString())}T00:00:00Z`, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' }); const calendarIds = Array.isArray(calendar.calendarIds) && calendar.calendarIds.length ? calendar.calendarIds : [calendar.calendarId || 'primary']; const events = []; for (const calendarId of calendarIds) { const data = await googleGet(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`, calendar, fetchImpl, env); events.push(...expandEvents(data.items).map(event => ({ ...event, calendarId }))); } return [...new Map(events.map(event => [`${event.calendarId}|${event.id}|${event.date}`, event])).values()]; }

async function fetchZoneBHolidays(startDate, endDate, fetchImpl = fetch) {
  const where = `zones="Zone B" and start_date <= date'${endDate}' and end_date >= date'${startDate}'`;
  const response = await fetchImpl(`${HOLIDAYS_API}?${new URLSearchParams({ where, limit: '100', select: 'description,start_date,end_date' })}`); if (!response.ok) throw new Error(`Le calendrier scolaire a répondu ${response.status}.`);
  const data = await response.json(); const holidays = (data.results || []).map(item => ({ name: item.description, start: dayKey(item.start_date), end: dayKey(item.end_date) })); return [...new Map(holidays.map(item => [`${item.name}|${item.start}|${item.end}`, item])).values()];
}

function createOAuthState() { return randomBytes(24).toString('hex'); }

module.exports = { classifyEvent, expandEvents, googleConfig, authorizationUrl, tokenRequest, fetchCalendars, fetchEvents, fetchZoneBHolidays, createOAuthState };
