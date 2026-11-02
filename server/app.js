import 'dotenv/config'
import crypto from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import Decimal from 'decimal.js'
import connectPgSimple from 'connect-pg-simple'
import cors from 'cors'
import ExcelJS from 'exceljs'
import express from 'express'
import multer from 'multer'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import rateLimit from 'express-rate-limit'
import session from 'express-session'
import helmet from 'helmet'
import { z } from 'zod'
import { inTransaction, pool } from './db.js'
import { calculateMilkAmounts } from './milk-pricing.js'
import { extractPdfEffectiveDate, parsePdfRateChartPages } from './rate-chart.js'
import { idSchema, pageSchema, parseBody } from './validation.js'

const app = express()
const PgSession = connectPgSimple(session)
const photoDirectory = path.resolve(
  process.env.UPLOAD_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data', 'producer-photos'),
)
const profilePhotoDirectory = path.join(photoDirectory, 'user-profiles')
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
})
const chartUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
})
const isProduction = process.env.NODE_ENV === 'production'
const allowedOrigins = new Set(
  (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN
    || 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret || sessionSecret.length < 32 || sessionSecret.toLowerCase().includes('replace-with')) {
  throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.')
}

if (isProduction) app.set('trust proxy', 1)

app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, origin || false)
    return callback(new Error('Origin is not allowed.'))
  },
  credentials: true,
}))
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok' })
  } catch (error) {
    console.error('API readiness check failed:', error.message)
    res.status(503).json({ error: 'Database is not ready.' })
  }
})
app.use(express.json({ limit: '100kb' }))
app.use(session({
  name: 'doudhvyavastha.sid',
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12,
  },
}))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait and try again.' },
})
const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  dairyName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  mobile: z.string().trim().regex(/^\+?[0-9][0-9\s()-]{6,19}$/).transform(normalizeMobile),
  password: z.string().min(10).max(128),
  confirmPassword: z.string().max(128),
  village: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional().default(''),
  consent: z.preprocess((value) => value === true || value === 'true', z.literal(true)),
}).refine((value) => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Passwords do not match.',
})
const loginSchema = z.object({
  identity: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
})
const producerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mobile: z.string().trim().max(30).optional().default(''),
  village: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
})
const feedIssueSchema = z.object({
  producerId: idSchema,
  feedItemId: idSchema,
  issueDate: z.iso.date(),
  quantity: z.coerce.number().finite().gt(0).max(999999999.999).multipleOf(0.001),
  ratePerUnit: z.coerce.number().finite().min(0).max(10000000).multipleOf(0.01),
  remarks: z.string().trim().max(1000).optional().default(''),
})
const advanceSchema = z.object({
  producerId: idSchema,
  advanceDate: z.iso.date(),
  amount: z.coerce.number().finite().gt(0).max(999999999999.99).multipleOf(0.01),
  remarks: z.string().trim().max(1000).optional().default(''),
})
const paymentSchema = z.object({
  producerId: idSchema,
  paymentDate: z.iso.date(),
  amount: z.coerce.number().finite().gt(0).max(999999999999.99).multipleOf(0.01),
  remarks: z.string().trim().max(1000).optional().default(''),
})
const feedSchema = z.object({
  itemCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  rate: z.coerce.number().finite().min(0).max(10000000).multipleOf(0.01),
  unit: z.string().trim().min(1).max(30),
  description: z.string().trim().max(1000).optional().default(''),
})
const ruleSchema = z.object({
  milkType: z.enum(['COW', 'BUFFALO']),
  effectiveFrom: z.iso.date(),
  fatMin: z.coerce.number().min(0).max(20).multipleOf(0.01),
  fatMax: z.coerce.number().gt(0).max(20).multipleOf(0.01),
  snfMin: z.coerce.number().min(0).max(20).multipleOf(0.01),
  snfMax: z.coerce.number().gt(0).max(20).multipleOf(0.01),
  ratePerLitre: z.coerce.number().min(0).max(100000).multipleOf(0.0001),
}).refine((value) => value.fatMax > value.fatMin && value.snfMax > value.snfMin, {
  message: 'Maximum Fat and SNF must exceed their minimums.',
})
const milkSchema = z.object({
  producerId: idSchema,
  sessionDate: z.iso.date(),
  sessionType: z.enum(['MORNING', 'EVENING']),
  collectedAt: z.iso.datetime({ offset: true }),
  milkType: z.enum(['COW', 'BUFFALO']),
  startReading: z.coerce.number().finite().min(0).max(999999999.999).multipleOf(0.001),
  endReading: z.coerce.number().finite().min(0).max(999999999.999).multipleOf(0.001),
  fat: z.coerce.number().finite().min(0).max(20).multipleOf(0.01),
  snf: z.coerce.number().finite().min(0).max(20).multipleOf(0.01),
  notes: z.string().trim().max(1000).optional().default(''),
  noSupply: z.boolean().optional().default(false),
}).refine((value) => value.noSupply
  ? value.endReading === value.startReading
  : value.endReading > value.startReading, {
  path: ['endReading'],
  message: 'For a zero-supply entry, readings must match; otherwise the end reading must be greater.',
}).refine((value) => value.noSupply
  || new Decimal(value.endReading).minus(value.startReading).toDecimalPlaces(3).gt(0), {
  path: ['endReading'],
  message: 'The calculated quantity must be at least 0.001 litres.',
})
const milkQuoteSchema = z.object({
  sessionDate: z.iso.date(),
  milkType: z.enum(['COW', 'BUFFALO']),
  startReading: z.coerce.number().finite().min(0).max(999999999.999).multipleOf(0.001),
  endReading: z.coerce.number().finite().min(0).max(999999999.999).multipleOf(0.001),
  fat: z.coerce.number().finite().min(0).max(20).multipleOf(0.01),
  snf: z.coerce.number().finite().min(0).max(20).multipleOf(0.01),
  noSupply: z.boolean().optional().default(false),
}).refine((value) => !value.noSupply || value.endReading === value.startReading, {
  path: ['endReading'],
  message: 'For a zero-supply quote, the readings must match.',
})
const dairySchema = z.object({
  registeredName: z.string().trim().min(2).max(100),
  displayName: z.string().trim().min(2).max(120),
  village: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional().default(''),
})

function normalizeMobile(value) {
  const compact = value.replace(/[\s()-]/g, '')
  return compact.startsWith('+') ? `+${compact.slice(1).replace(/\D/g, '')}` : compact.replace(/\D/g, '')
}

function sniffImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: 'png', mimeType: 'image/png' }
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { extension: 'webp', mimeType: 'image/webp' }
  }
  return null
}

function photoUrl(id, photoStorageKey) {
  return photoStorageKey ? `/api/private/producers/${id}/photo` : null
}

function producerRow(row) {
  const { photo_storage_key: photoStorageKey, ...item } = row
  return { ...item, photo_url: photoUrl(row.id, photoStorageKey) }
}

function defaultDisplayName(name) {
  return /dudh\s+dairy$/i.test(name) ? name : `${name} Dudh Dairy`
}

function csrfToken() {
  return crypto.randomBytes(32).toString('hex')
}

function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const token = req.get('x-csrf-token')
  const expected = req.session.csrfToken
  if (
    typeof token !== 'string'
    || typeof expected !== 'string'
    || token.length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return res.status(403).json({ error: 'Your session expired. Refresh the page and try again.' })
  }
  next()
}

app.use('/api', requireCsrf)

function requireAuth(req, res, next) {
  if (!req.session.userId || !req.session.dairyId) {
    return res.status(401).json({ error: 'Please log in to continue.' })
  }
  next()
}

function requireOwner(req, res, next) {
  if (req.membership?.role !== 'OWNER') {
    return res.status(403).json({ error: 'Only the dairy owner can change these settings.' })
  }
  next()
}

app.get('/api/auth/csrf', (req, res) => {
  req.session.csrfToken ||= csrfToken()
  res.json({ csrfToken: req.session.csrfToken })
})

app.post('/api/auth/register', authLimiter, photoUpload.single('photo'), parseBody(registrationSchema), async (req, res) => {
  const data = req.validated
  const image = req.file ? sniffImage(req.file.buffer) : null
  if (req.file && !image) return res.status(415).json({ error: 'Photo must be a valid JPEG, PNG, or WebP image.' })
  const passwordHash = await bcrypt.hash(data.password, 12)
  const photoStorageKey = image ? `${crypto.randomUUID()}.${image.extension}` : null
  const profilePhotoPath = photoStorageKey ? path.join(profilePhotoDirectory, photoStorageKey) : null
  try {
    if (profilePhotoPath) {
      await mkdir(profilePhotoDirectory, { recursive: true })
      await writeFile(profilePhotoPath, req.file.buffer, { flag: 'wx' })
    }
    const account = await inTransaction(async (client) => {
      const user = await client.query(
        `INSERT INTO users (full_name, email, mobile, password_hash, photo_storage_key, photo_mime_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, email, mobile`,
        [data.fullName, data.email, data.mobile, passwordHash, photoStorageKey, image?.mimeType || null],
      )
      const dairy = await client.query(
        `INSERT INTO dairies (registered_name, display_name, owner_name, mobile, village, address)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, registered_name, display_name, village`,
        [data.dairyName, defaultDisplayName(data.dairyName), data.fullName, data.mobile, data.village, data.address],
      )
      await client.query(
        `INSERT INTO dairy_memberships (dairy_id, user_id, role)
         VALUES ($1, $2, 'OWNER')`,
        [dairy.rows[0].id, user.rows[0].id],
      )
      await client.query(
        `INSERT INTO audit_logs (dairy_id, user_id, action, entity_type, entity_id)
         VALUES ($1, $2, 'CREATE', 'dairy', $3)`,
        [dairy.rows[0].id, user.rows[0].id, dairy.rows[0].id],
      )
      return { user: user.rows[0], dairy: dairy.rows[0] }
    })
    res.status(201).json({
      message: 'Your dairy account is ready. Please log in.',
      account: { email: account.user.email, dairyName: account.dairy.display_name },
    })
  } catch (error) {
    if (profilePhotoPath) {
      await unlink(profilePhotoPath).catch((cleanupError) => {
        if (cleanupError.code !== 'ENOENT') console.error('Could not remove unreferenced registration photo:', cleanupError.message)
      })
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with this email is already registered.' })
    }
    throw error
  }
})

app.post('/api/auth/login', authLimiter, parseBody(loginSchema), async (req, res, next) => {
  const { identity, password } = req.validated
  const email = identity.toLowerCase()
  const mobile = normalizeMobile(identity)
  const result = await pool.query(
    `SELECT u.id, u.password_hash, m.dairy_id
     FROM users u JOIN dairy_memberships m ON m.user_id = u.id
     WHERE lower(u.email) = $1 OR u.mobile = $2
     ORDER BY m.created_at LIMIT 1`,
    [email, mobile],
  )
  const user = result.rows[0]
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false
  if (!valid) return res.status(401).json({ error: 'Invalid email/mobile number or password.' })

  req.session.regenerate((error) => {
    if (error) return next(error)
    req.session.userId = user.id
    req.session.dairyId = user.dairy_id
    req.session.csrfToken = csrfToken()
    req.session.save((saveError) => {
      if (saveError) return next(saveError)
      res.json({ message: 'Logged in successfully.' })
    })
  })
})

app.post('/api/auth/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error)
    res.clearCookie('doudhvyavastha.sid', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
    })
    res.status(204).end()
  })
})

app.use('/api/private', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.dairy_id, m.user_id, m.role, m.permissions, u.full_name, u.email,
              u.photo_storage_key, u.photo_mime_type,
              d.registered_name, d.display_name, d.village, d.address, d.logo_url
       FROM dairy_memberships m
       JOIN users u ON u.id = m.user_id
       JOIN dairies d ON d.id = m.dairy_id
       WHERE m.user_id = $1 AND m.dairy_id = $2`,
      [req.session.userId, req.session.dairyId],
    )
    if (!result.rowCount) return res.status(403).json({ error: 'This account has no access to the dairy.' })
    req.membership = result.rows[0]
    next()
  } catch (error) {
    next(error)
  }
})

app.get('/api/private/me', (req, res) => {
  res.json({
    user: {
      fullName: req.membership.full_name,
      email: req.membership.email,
      role: req.membership.role,
      photoUrl: req.membership.photo_storage_key ? '/api/private/me/photo' : null,
    },
    dairy: {
      registeredName: req.membership.registered_name,
      displayName: req.membership.display_name,
      village: req.membership.village,
      address: req.membership.address,
      logoUrl: req.membership.logo_url,
    },
  })
})

app.get('/api/private/me/photo', async (req, res) => {
  const { photo_storage_key: storageKey, photo_mime_type: mimeType } = req.membership
  if (!storageKey) return res.status(404).json({ error: 'You have not added a profile photo.' })
  try {
    const bytes = await readFile(path.join(profilePhotoDirectory, storageKey))
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, no-store' })
    return res.send(bytes)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return res.status(404).json({ error: 'Your profile photo file is missing. Upload the photo again.' })
  }
})

app.post('/api/private/me/photo', photoUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP image smaller than 2 MB.' })
  const image = sniffImage(req.file.buffer)
  if (!image) return res.status(415).json({ error: 'Photo must be a valid JPEG, PNG, or WebP image.' })
  const key = `${crypto.randomUUID()}.${image.extension}`
  await mkdir(profilePhotoDirectory, { recursive: true })
  const photoPath = path.join(profilePhotoDirectory, key)
  await writeFile(photoPath, req.file.buffer, { flag: 'wx' })
  try {
    await inTransaction(async (client) => {
      await client.query(
        `UPDATE users SET photo_storage_key = $1, photo_mime_type = $2, updated_at = now()
         WHERE id = $3`,
        [key, image.mimeType, req.membership.user_id],
      )
      await audit(req, 'UPDATE_PHOTO', 'user', req.membership.user_id, client)
    })
  } catch (error) {
    await unlink(photoPath).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') console.error('Could not remove unreferenced profile photo:', cleanupError.message)
    })
    throw error
  }
  if (req.membership.photo_storage_key) {
    await unlink(path.join(profilePhotoDirectory, req.membership.photo_storage_key)).catch((error) => {
      if (error.code !== 'ENOENT') console.error('Could not remove replaced profile photo:', error.message)
    })
  }
  res.json({ photoUrl: '/api/private/me/photo' })
})

app.delete('/api/private/me/photo', async (req, res) => {
  const result = await inTransaction(async (client) => {
    const user = await client.query(
      'SELECT photo_storage_key FROM users WHERE id = $1 FOR UPDATE',
      [req.membership.user_id],
    )
    await client.query(
      'UPDATE users SET photo_storage_key = NULL, photo_mime_type = NULL, updated_at = now() WHERE id = $1',
      [req.membership.user_id],
    )
    await audit(req, 'REMOVE_PHOTO', 'user', req.membership.user_id, client)
    return user.rows[0]?.photo_storage_key
  })
  if (result) await unlink(path.join(profilePhotoDirectory, result)).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  res.status(204).end()
})

const collectionSessionSchema = z.object({
  sessionDate: z.iso.date(),
  sessionType: z.enum(['MORNING', 'EVENING']),
})

async function getCollectionSessions(dairyId, sessionDate) {
  const result = await pool.query(
    `WITH active_producers AS (
       SELECT id, producer_code, name FROM producers
       WHERE dairy_id = $1 AND is_active = true
     ),
     session_types AS (
       SELECT unnest(ARRAY['MORNING', 'EVENING']::text[]) AS session_type
     ),
     entry_stats AS (
       SELECT me.session_type, count(DISTINCT ap.id)::int AS supplied_count,
              COALESCE(sum(me.quantity_litres), 0) AS quantity,
              COALESCE(sum(me.amount), 0) AS amount,
              COALESCE(sum(me.quantity_litres) FILTER (WHERE me.milk_type = 'COW'), 0) AS cow_quantity,
              COALESCE(sum(me.quantity_litres) FILTER (WHERE me.milk_type = 'BUFFALO'), 0) AS buffalo_quantity
       FROM milk_entries me
       JOIN active_producers ap ON ap.id = me.producer_id
       WHERE me.dairy_id = $1 AND me.session_date = $2::date
       GROUP BY me.session_type
     )
     SELECT st.session_type, cs.id AS session_id,
            COALESCE(cs.status, 'NOT_STARTED') AS status,
            cs.started_at, cs.closed_at,
            (SELECT count(*)::int FROM active_producers) AS producer_count,
            COALESCE(es.supplied_count, 0) AS supplied_count,
            (SELECT count(*)::int FROM active_producers) - COALESCE(es.supplied_count, 0) AS pending_count,
            COALESCE(es.quantity, 0) AS quantity,
            COALESCE(es.amount, 0) AS amount,
            COALESCE(es.cow_quantity, 0) AS cow_quantity,
            COALESCE(es.buffalo_quantity, 0) AS buffalo_quantity,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', ap.id, 'producerCode', ap.producer_code, 'name', ap.name
              ) ORDER BY ap.name)
              FROM active_producers ap
              WHERE NOT EXISTS (
                SELECT 1 FROM milk_entries me
                WHERE me.dairy_id = $1 AND me.producer_id = ap.id
                  AND me.session_date = $2::date AND me.session_type = st.session_type
              )
            ), '[]'::json) AS pending_producers
     FROM session_types st
     LEFT JOIN collection_sessions cs
       ON cs.dairy_id = $1 AND cs.session_date = $2::date AND cs.session_type = st.session_type
     LEFT JOIN entry_stats es ON es.session_type = st.session_type
     ORDER BY CASE st.session_type WHEN 'MORNING' THEN 1 ELSE 2 END`,
    [dairyId, sessionDate],
  )
  return result.rows
}

app.get('/api/private/sessions', async (req, res) => {
  const sessionDate = z.iso.date().parse(req.query.date)
  res.json({ sessions: await getCollectionSessions(req.membership.dairy_id, sessionDate) })
})

app.post('/api/private/sessions', requireOwner, parseBody(collectionSessionSchema), async (req, res) => {
  const { sessionDate, sessionType } = req.validated
  const result = await inTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO collection_sessions (dairy_id, session_date, session_type, status, started_by)
       VALUES ($1, $2, $3, 'OPEN', $4)
       ON CONFLICT (dairy_id, session_date, session_type) DO NOTHING
       RETURNING id, session_date, session_type, status, started_at`,
      [req.membership.dairy_id, sessionDate, sessionType, req.membership.user_id],
    )
    if (created.rowCount) {
      await audit(req, 'START', 'collection_session', created.rows[0].id, client)
      return { status: 201, session: created.rows[0], resumed: false }
    }
    const existing = await client.query(
      `SELECT id, session_date, session_type, status, started_at
       FROM collection_sessions
       WHERE dairy_id = $1 AND session_date = $2 AND session_type = $3
       FOR UPDATE`,
      [req.membership.dairy_id, sessionDate, sessionType],
    )
    if (existing.rows[0].status === 'CLOSED') {
      return { status: 409, error: 'This session is already closed. Reopen it before making corrections.' }
    }
    return { status: 200, session: existing.rows[0], resumed: true }
  })
  if (result.error) return res.status(result.status).json({ error: result.error })
  res.status(result.status).json({ session: result.session, resumed: result.resumed })
})

app.post('/api/private/sessions/:id/close', requireOwner, async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await inTransaction(async (client) => {
    const session = await client.query(
      'SELECT status FROM collection_sessions WHERE id = $1 AND dairy_id = $2 FOR UPDATE',
      [id, req.membership.dairy_id],
    )
    if (!session.rowCount) return { status: 404, error: 'Collection session not found.' }
    if (session.rows[0].status === 'CLOSED') return { status: 409, error: 'This session is already closed.' }
    const closed = await client.query(
      `UPDATE collection_sessions SET status = 'CLOSED', closed_by = $1, closed_at = now()
       WHERE id = $2 AND dairy_id = $3
       RETURNING id, session_date, session_type, status, started_at, closed_at`,
      [req.membership.user_id, id, req.membership.dairy_id],
    )
    await audit(req, 'CLOSE', 'collection_session', id, client)
    return { status: 200, session: closed.rows[0] }
  })
  if (result.error) return res.status(result.status).json({ error: result.error })
  res.json({ session: result.session })
})

app.post('/api/private/sessions/:id/reopen', requireOwner, async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await inTransaction(async (client) => {
    const session = await client.query(
      'SELECT status FROM collection_sessions WHERE id = $1 AND dairy_id = $2 FOR UPDATE',
      [id, req.membership.dairy_id],
    )
    if (!session.rowCount) return { status: 404, error: 'Collection session not found.' }
    if (session.rows[0].status === 'OPEN') return { status: 409, error: 'This session is already open.' }
    const reopened = await client.query(
      `UPDATE collection_sessions SET status = 'OPEN', closed_by = NULL, closed_at = NULL
       WHERE id = $1 AND dairy_id = $2
       RETURNING id, session_date, session_type, status, started_at`,
      [id, req.membership.dairy_id],
    )
    await audit(req, 'REOPEN', 'collection_session', id, client)
    return { status: 200, session: reopened.rows[0] }
  })
  if (result.error) return res.status(result.status).json({ error: result.error })
  res.json({ session: result.session })
})

app.put('/api/private/dairy', requireOwner, parseBody(dairySchema), async (req, res) => {
  const { registeredName, displayName, village, address } = req.validated
  const result = await pool.query(
    `UPDATE dairies SET registered_name = $1, display_name = $2, village = $3,
      address = $4, updated_at = now()
     WHERE id = $5 RETURNING registered_name, display_name, village, address, logo_url`,
    [registeredName, displayName, village, address, req.membership.dairy_id],
  )
  await audit(req, 'UPDATE', 'dairy', req.membership.dairy_id)
  res.json({ dairy: result.rows[0] })
})

app.get('/api/private/dashboard', async (req, res) => {
  const dairyId = req.membership.dairy_id
  const selectedDate = req.query.date ? z.iso.date().parse(req.query.date) : new Date().toISOString().slice(0, 10)
  const [totals, producers, recent, trend, sessions] = await Promise.all([
    pool.query(
      `SELECT COALESCE(sum(quantity_litres), 0) AS quantity,
              COALESCE(sum(amount), 0) AS amount,
              count(*) FILTER (WHERE milk_type = 'COW') AS cow_count,
              COALESCE(sum(quantity_litres) FILTER (WHERE milk_type = 'COW'), 0) AS cow_quantity,
              count(*) FILTER (WHERE milk_type = 'BUFFALO') AS buffalo_count,
              COALESCE(sum(quantity_litres) FILTER (WHERE milk_type = 'BUFFALO'), 0) AS buffalo_quantity
       FROM milk_entries
       WHERE dairy_id = $1
         AND (session_date = $2::date OR (session_date IS NULL AND collected_at::date = $2::date))`,
      [dairyId, selectedDate],
    ),
    pool.query('SELECT count(*)::int AS count FROM producers WHERE dairy_id = $1 AND is_active = true', [dairyId]),
    pool.query(
      `SELECT id, producer_name_snapshot AS producer_name, producer_code_snapshot AS producer_code,
             milk_type, quantity_litres, amount, collected_at, session_date, session_type
       FROM milk_entries WHERE dairy_id = $1 ORDER BY collected_at DESC LIMIT 6`,
      [dairyId],
    ),
    pool.query(
      `SELECT COALESCE(session_date, collected_at::date) AS date, COALESCE(sum(quantity_litres), 0) AS quantity
       FROM milk_entries WHERE dairy_id = $1
         AND COALESCE(session_date, collected_at::date) >= ($2::date - interval '6 days')
         AND COALESCE(session_date, collected_at::date) <= $2::date
       GROUP BY COALESCE(session_date, collected_at::date) ORDER BY date`,
      [dairyId, selectedDate],
    ),
    getCollectionSessions(dairyId, selectedDate),
  ])
  res.json({
    totals: totals.rows[0],
    producerCount: producers.rows[0].count,
    recent: recent.rows,
    trend: trend.rows,
    sessions,
  })
})

function listRoute({ table, columns, searchFields, orderBy, mapItem = (item) => item, queryFilter }) {
  return async (req, res) => {
    const { page, limit, search } = pageSchema.parse(req.query)
    const offset = (page - 1) * limit
    const where = [`dairy_id = $1`]
    const params = [req.membership.dairy_id]
    if (search) {
      params.push(`%${search}%`)
      where.push(`(${searchFields.map((field) => `${field} ILIKE $${params.length}`).join(' OR ')})`)
    }
    const additionalFilter = queryFilter?.(req.query, params)
    if (additionalFilter) where.push(additionalFilter)
    const filter = where.join(' AND ')
    const [items, count] = await Promise.all([
      pool.query(
        `SELECT ${columns} FROM ${table} WHERE ${filter} ORDER BY ${orderBy}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT count(*)::int AS total FROM ${table} WHERE ${filter}`, params),
    ])
    res.json({ items: items.rows.map(mapItem), total: count.rows[0].total, page, limit })
  }
}

function audit(req, action, entityType, entityId, client = pool) {
  return client.query(
    `INSERT INTO audit_logs (dairy_id, user_id, action, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.membership.dairy_id, req.membership.user_id, action, entityType, String(entityId)],
  )
}

app.get('/api/private/producers', listRoute({
  table: 'producers',
  columns: 'id, producer_code, name, mobile, village, address, notes, is_active, photo_storage_key, created_at',
  searchFields: ['producer_code', 'name', 'mobile', 'village'],
  orderBy: 'name ASC',
  mapItem: producerRow,
  queryFilter: (query, params) => {
    const status = z.enum(['all', 'active', 'inactive']).optional().parse(query.status)
    if (!status || status === 'all') return null
    params.push(status === 'active')
    return `is_active = $${params.length}`
  },
}))
app.get('/api/private/producers/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await pool.query(
    `SELECT id, producer_code, name, mobile, village, address, notes, is_active, photo_storage_key, created_at
     FROM producers WHERE id = $1 AND dairy_id = $2`,
    [id, req.membership.dairy_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Producer not found.' })
  res.json({ item: producerRow(result.rows[0]) })
})
app.get('/api/private/producers/:id/photo', async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await pool.query(
    `SELECT photo_storage_key, photo_mime_type FROM producers
     WHERE id = $1 AND dairy_id = $2`,
    [id, req.membership.dairy_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Producer not found.' })
  if (!result.rows[0].photo_storage_key) return res.status(404).json({ error: 'This producer has no photo.' })
  try {
    const bytes = await readFile(path.join(photoDirectory, result.rows[0].photo_storage_key))
    res.set({ 'Content-Type': result.rows[0].photo_mime_type, 'Cache-Control': 'private, max-age=3600' })
    return res.send(bytes)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return res.status(404).json({ error: 'The producer photo file is missing. Upload the photo again.' })
  }
})
app.post('/api/private/producers/:id/photo', requireOwner, photoUpload.single('photo'), async (req, res) => {
  const id = idSchema.parse(req.params.id)
  if (!req.file) return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP image smaller than 2 MB.' })
  const image = sniffImage(req.file.buffer)
  if (!image) return res.status(415).json({ error: 'Photo must be a valid JPEG, PNG, or WebP image.' })
  const producer = await pool.query(
    'SELECT photo_storage_key FROM producers WHERE id = $1 AND dairy_id = $2',
    [id, req.membership.dairy_id],
  )
  if (!producer.rowCount) return res.status(404).json({ error: 'Producer not found.' })
  const key = `${crypto.randomUUID()}.${image.extension}`
  await mkdir(photoDirectory, { recursive: true })
  await writeFile(path.join(photoDirectory, key), req.file.buffer, { flag: 'wx' })
  try {
    await inTransaction(async (client) => {
      await client.query(
        `UPDATE producers SET photo_storage_key = $1, photo_mime_type = $2, updated_at = now()
         WHERE id = $3 AND dairy_id = $4`,
        [key, image.mimeType, id, req.membership.dairy_id],
      )
      await audit(req, 'UPDATE_PHOTO', 'producer', id, client)
    })
  } catch (error) {
    await unlink(path.join(photoDirectory, key)).catch(() => {})
    throw error
  }
  if (producer.rows[0].photo_storage_key) {
    await unlink(path.join(photoDirectory, producer.rows[0].photo_storage_key)).catch((error) => {
      if (error.code !== 'ENOENT') console.error('Could not remove replaced producer photo:', error.message)
    })
  }
  res.json({ photoUrl: photoUrl(id, key) })
})
app.delete('/api/private/producers/:id/photo', requireOwner, async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await inTransaction(async (client) => {
    const producer = await client.query(
      `SELECT photo_storage_key FROM producers
       WHERE id = $1 AND dairy_id = $2 FOR UPDATE`,
      [id, req.membership.dairy_id],
    )
    if (!producer.rowCount) return null
    await client.query(
      `UPDATE producers SET photo_storage_key = NULL, photo_mime_type = NULL, updated_at = now()
       WHERE id = $1 AND dairy_id = $2`,
      [id, req.membership.dairy_id],
    )
    await audit(req, 'REMOVE_PHOTO', 'producer', id, client)
    return { storageKey: producer.rows[0].photo_storage_key }
  })
  if (result === null) return res.status(404).json({ error: 'Producer not found.' })
  if (result.storageKey) await unlink(path.join(photoDirectory, result.storageKey)).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  res.status(204).end()
})
app.post('/api/private/producers', requireOwner, parseBody(producerSchema), async (req, res) => {
  const data = req.validated
  const item = await inTransaction(async (client) => {
    const counter = await client.query(
      `INSERT INTO dairy_producer_counters (dairy_id, next_value)
       VALUES ($1, 2)
       ON CONFLICT (dairy_id) DO UPDATE
         SET next_value = dairy_producer_counters.next_value + 1
       RETURNING next_value - 1 AS code_number`,
      [req.membership.dairy_id],
    )
    const code = `P-${String(counter.rows[0].code_number).padStart(4, '0')}`
    const result = await client.query(
      `INSERT INTO producers (dairy_id, producer_code, name, mobile, village, address, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, producer_code, name, mobile, village, address, notes, is_active, photo_storage_key`,
      [req.membership.dairy_id, code, data.name, data.mobile, data.village, data.address, data.notes],
    )
    await audit(req, 'CREATE', 'producer', result.rows[0].id, client)
    return producerRow(result.rows[0])
  })
  res.status(201).json({ item })
})
app.put('/api/private/producers/:id', requireOwner, parseBody(producerSchema), async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const data = req.validated
  const result = await pool.query(
    `UPDATE producers SET name = $1, mobile = $2, village = $3,
       address = $4, notes = $5, updated_at = now()
     WHERE id = $6 AND dairy_id = $7
     RETURNING id, producer_code, name, mobile, village, address, notes, is_active`,
    [data.name, data.mobile, data.village, data.address, data.notes, id, req.membership.dairy_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Producer not found.' })
  await audit(req, 'UPDATE', 'producer', id)
  res.json({ item: result.rows[0] })
})
app.patch('/api/private/producers/:id/status', requireOwner, parseBody(z.object({
  isActive: z.boolean(),
})), async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const item = await inTransaction(async (client) => {
    const result = await client.query(
      `UPDATE producers SET is_active = $1, updated_at = now()
       WHERE id = $2 AND dairy_id = $3
       RETURNING id, is_active`,
      [req.validated.isActive, id, req.membership.dairy_id],
    )
    if (!result.rowCount) return null
    await audit(req, req.validated.isActive ? 'ACTIVATE' : 'DEACTIVATE', 'producer', id, client)
    return result.rows[0]
  })
  if (!item) return res.status(404).json({ error: 'Producer not found.' })
  res.json({ item })
})
app.delete('/api/private/producers/:id', requireOwner, async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const history = await pool.query(
    `SELECT 1 FROM milk_entries WHERE producer_id = $1 AND dairy_id = $2
     UNION ALL SELECT 1 FROM feed_issues WHERE producer_id = $1 AND dairy_id = $2
     UNION ALL SELECT 1 FROM producer_advances WHERE producer_id = $1 AND dairy_id = $2
     UNION ALL SELECT 1 FROM producer_payments WHERE producer_id = $1 AND dairy_id = $2
     LIMIT 1`,
    [id, req.membership.dairy_id],
  )
  if (history.rowCount) {
    return res.status(409).json({ error: 'This producer has collection or account history and cannot be deleted. Deactivate the producer to retain historical records.' })
  }
  const result = await inTransaction(async (client) => {
    const deleted = await client.query(
      'DELETE FROM producers WHERE id = $1 AND dairy_id = $2 RETURNING id, photo_storage_key',
      [id, req.membership.dairy_id],
    )
    if (!deleted.rowCount) return null
    await audit(req, 'DELETE', 'producer', id, client)
    return deleted.rows[0]
  })
  if (!result) return res.status(404).json({ error: 'Producer not found.' })
  if (result.photo_storage_key) {
    await unlink(path.join(photoDirectory, result.photo_storage_key)).catch((error) => {
      if (error.code !== 'ENOENT') console.error('Could not remove deleted producer photo:', error.message)
    })
  }
  res.status(204).end()
})

app.get('/api/private/feed-items', listRoute({
  table: 'feed_items',
  columns: 'id, item_code, name, rate, unit, description, created_at',
  searchFields: ['item_code', 'name', 'description'],
  orderBy: 'name ASC',
}))
app.get('/api/private/feed-items/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await pool.query(
    `SELECT id, item_code, name, rate, unit, description
     FROM feed_items WHERE id = $1 AND dairy_id = $2`,
    [id, req.membership.dairy_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Feed item not found.' })
  res.json({ item: result.rows[0] })
})
app.post('/api/private/feed-items', requireOwner, parseBody(feedSchema), async (req, res) => {
  const data = req.validated
  const result = await pool.query(
    `INSERT INTO feed_items (dairy_id, item_code, name, rate, unit, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, item_code, name, rate, unit, description`,
    [req.membership.dairy_id, data.itemCode, data.name, data.rate, data.unit, data.description],
  )
  await audit(req, 'CREATE', 'feed_item', result.rows[0].id)
  res.status(201).json({ item: result.rows[0] })
})
app.put('/api/private/feed-items/:id', requireOwner, parseBody(feedSchema), async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const data = req.validated
  const result = await pool.query(
    `UPDATE feed_items SET item_code = $1, name = $2, rate = $3, unit = $4,
      description = $5, updated_at = now()
     WHERE id = $6 AND dairy_id = $7
     RETURNING id, item_code, name, rate, unit, description`,
    [data.itemCode, data.name, data.rate, data.unit, data.description, id, req.membership.dairy_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Feed item not found.' })
  await audit(req, 'UPDATE', 'feed_item', id)
  res.json({ item: result.rows[0] })
})
app.delete('/api/private/feed-items/:id', requireOwner, async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await pool.query(
    'DELETE FROM feed_items WHERE id = $1 AND dairy_id = $2 RETURNING id',
    [id, req.membership.dairy_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Feed item not found.' })
  await audit(req, 'DELETE', 'feed_item', id)
  res.status(204).end()
})

function dateFilters(req, dateColumn, params) {
  const filters = []
  if (req.query.from) {
    params.push(z.iso.date().parse(req.query.from))
    filters.push(`${dateColumn} >= $${params.length}::date`)
  }
  if (req.query.to) {
    params.push(z.iso.date().parse(req.query.to))
    filters.push(`${dateColumn} <= $${params.length}::date`)
  }
  return filters
}

app.get('/api/private/feed-issues', async (req, res) => {
  const params = [req.membership.dairy_id]
  const filters = ['fi.dairy_id = $1', ...dateFilters(req, 'fi.issue_date', params)]
  if (req.query.producerId) {
    params.push(idSchema.parse(req.query.producerId))
    filters.push(`fi.producer_id = $${params.length}`)
  }
  const result = await pool.query(
    `SELECT fi.id, fi.producer_id, fi.feed_item_id, fi.issue_date, fi.quantity, fi.unit,
            fi.rate_per_unit, fi.amount, fi.remarks, fi.producer_code_snapshot AS producer_code,
            fi.producer_name_snapshot AS producer_name, fi.feed_name_snapshot AS feed_name
     FROM feed_issues fi WHERE ${filters.join(' AND ')}
     ORDER BY fi.issue_date DESC, fi.created_at DESC LIMIT 500`,
    params,
  )
  const total = await pool.query(
    `SELECT COALESCE(sum(fi.amount), 0) AS total_amount
     FROM feed_issues fi WHERE ${filters.join(' AND ')}`,
    params,
  )
  res.json({ items: result.rows, totalAmount: total.rows[0].total_amount })
})

app.post('/api/private/feed-issues', requireOwner, parseBody(feedIssueSchema), async (req, res) => {
  const data = req.validated
  const result = await inTransaction(async (client) => {
    const [producer, feed] = await Promise.all([
      client.query(
        'SELECT id, producer_code, name FROM producers WHERE id = $1 AND dairy_id = $2 AND is_active = true',
        [data.producerId, req.membership.dairy_id],
      ),
      client.query(
        'SELECT id, name, unit FROM feed_items WHERE id = $1 AND dairy_id = $2',
        [data.feedItemId, req.membership.dairy_id],
      ),
    ])
    if (!producer.rowCount) return { error: 'Active producer not found.', status: 404 }
    if (!feed.rowCount) return { error: 'Feed item not found.', status: 404 }
    const amount = new Decimal(data.quantity).mul(data.ratePerUnit).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    if (amount.gt('999999999999.99')) return { error: 'Feed issue total exceeds the supported amount.', status: 422 }
    const issue = await client.query(
      `INSERT INTO feed_issues
         (dairy_id, producer_id, feed_item_id, producer_code_snapshot, producer_name_snapshot,
          feed_name_snapshot, issue_date, quantity, unit, rate_per_unit, amount, remarks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, issue_date, quantity, unit, rate_per_unit, amount, remarks,
                 producer_code_snapshot AS producer_code, producer_name_snapshot AS producer_name,
                 feed_name_snapshot AS feed_name`,
      [req.membership.dairy_id, producer.rows[0].id, feed.rows[0].id,
        producer.rows[0].producer_code, producer.rows[0].name, feed.rows[0].name,
        data.issueDate, data.quantity, feed.rows[0].unit, data.ratePerUnit,
        amount.toFixed(2), data.remarks, req.membership.user_id],
    )
    await audit(req, 'CREATE', 'feed_issue', issue.rows[0].id, client)
    return { item: issue.rows[0] }
  })
  if (result.error) return res.status(result.status).json({ error: result.error })
  res.status(201).json({ item: result.item })
})

app.get('/api/private/advances', async (req, res) => {
  const params = [req.membership.dairy_id]
  const filters = ['dairy_id = $1', ...dateFilters(req, 'advance_date', params)]
  if (req.query.producerId) {
    params.push(idSchema.parse(req.query.producerId))
    filters.push(`producer_id = $${params.length}`)
  }
  const result = await pool.query(
    `SELECT id, producer_id, producer_code_snapshot AS producer_code,
            producer_name_snapshot AS producer_name, advance_date, amount, remarks, voided_at
     FROM producer_advances WHERE ${filters.join(' AND ')}
     ORDER BY advance_date DESC, created_at DESC LIMIT 500`,
    params,
  )
  res.json({ items: result.rows })
})

app.post('/api/private/advances', requireOwner, parseBody(advanceSchema), async (req, res) => {
  const data = req.validated
  const result = await inTransaction(async (client) => {
    const producer = await client.query(
      `SELECT producer_code, name FROM producers
       WHERE id = $1 AND dairy_id = $2 AND is_active = true`,
      [data.producerId, req.membership.dairy_id],
    )
    if (!producer.rowCount) return { error: 'Active producer not found.', status: 404 }
    const advance = await client.query(
      `INSERT INTO producer_advances
         (dairy_id, producer_id, producer_code_snapshot, producer_name_snapshot,
          advance_date, amount, remarks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, producer_id, producer_code_snapshot AS producer_code,
         producer_name_snapshot AS producer_name, advance_date, amount, remarks`,
      [req.membership.dairy_id, data.producerId, producer.rows[0].producer_code,
        producer.rows[0].name, data.advanceDate, data.amount, data.remarks, req.membership.user_id],
    )
    await audit(req, 'CREATE', 'producer_advance', advance.rows[0].id, client)
    return { item: advance.rows[0] }
  })
  if (result.error) return res.status(result.status).json({ error: result.error })
  res.status(201).json({ item: result.item })
})

app.post('/api/private/advances/:id/void', requireOwner, async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await inTransaction(async (client) => {
    const advance = await client.query(
      `UPDATE producer_advances SET voided_at = now(), voided_by = $1
       WHERE id = $2 AND dairy_id = $3 AND voided_at IS NULL
       RETURNING id`,
      [req.membership.user_id, id, req.membership.dairy_id],
    )
    if (!advance.rowCount) return null
    await audit(req, 'VOID', 'producer_advance', id, client)
    return advance.rows[0]
  })
  if (!result) return res.status(404).json({ error: 'Active advance not found.' })
  res.json({ item: result })
})

app.get('/api/private/payments', async (req, res) => {
  const params = [req.membership.dairy_id]
  const filters = ['dairy_id = $1', ...dateFilters(req, 'payment_date', params)]
  if (req.query.producerId) {
    params.push(idSchema.parse(req.query.producerId))
    filters.push(`producer_id = $${params.length}`)
  }
  const result = await pool.query(
    `SELECT id, producer_id, producer_code_snapshot AS producer_code,
            producer_name_snapshot AS producer_name, payment_date, amount, remarks
     FROM producer_payments WHERE ${filters.join(' AND ')}
     ORDER BY payment_date DESC, created_at DESC LIMIT 500`,
    params,
  )
  res.json({ items: result.rows })
})

app.post('/api/private/payments', requireOwner, parseBody(paymentSchema), async (req, res) => {
  const data = req.validated
  const outcome = await inTransaction(async (client) => {
    const producer = await client.query(
      `SELECT producer_code, name FROM producers
       WHERE id = $1 AND dairy_id = $2 FOR UPDATE`,
      [data.producerId, req.membership.dairy_id],
    )
    if (!producer.rowCount) return { error: 'Producer not found.', status: 404 }
    const balance = await client.query(
      `SELECT COALESCE((SELECT sum(amount) FROM milk_entries WHERE dairy_id = $1 AND producer_id = $2), 0)
         - COALESCE((SELECT sum(amount) FROM feed_issues WHERE dairy_id = $1 AND producer_id = $2), 0)
         - COALESCE((SELECT sum(amount) FROM producer_advances WHERE dairy_id = $1 AND producer_id = $2 AND voided_at IS NULL), 0)
         - COALESCE((SELECT sum(amount) FROM producer_payments WHERE dairy_id = $1 AND producer_id = $2), 0)
         AS outstanding`,
      [req.membership.dairy_id, data.producerId],
    )
    if (new Decimal(balance.rows[0].outstanding).lt(data.amount)) {
      return { error: 'Payment exceeds this producer’s current outstanding balance.', status: 422 }
    }
    const payment = await client.query(
      `INSERT INTO producer_payments
         (dairy_id, producer_id, producer_code_snapshot, producer_name_snapshot,
          payment_date, amount, remarks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, producer_id, producer_code_snapshot AS producer_code,
         producer_name_snapshot AS producer_name, payment_date, amount, remarks`,
      [req.membership.dairy_id, data.producerId, producer.rows[0].producer_code,
        producer.rows[0].name, data.paymentDate, data.amount, data.remarks, req.membership.user_id],
    )
    await audit(req, 'CREATE', 'producer_payment', payment.rows[0].id, client)
    return { item: payment.rows[0] }
  })
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error })
  res.status(201).json({ item: outcome.item })
})

app.get('/api/private/producer-statement', async (req, res) => {
  const producerId = idSchema.parse(req.query.producerId)
  const from = z.iso.date().parse(req.query.from)
  const to = z.iso.date().parse(req.query.to)
  if (from > to) return res.status(422).json({ error: 'Start date must be on or before end date.' })
  const dairyId = req.membership.dairy_id
  const producerResult = await pool.query(
    `SELECT id, producer_code, name, mobile, village, address, notes, is_active, photo_storage_key
     FROM producers WHERE id = $1 AND dairy_id = $2`,
    [producerId, dairyId],
  )
  if (!producerResult.rowCount) return res.status(404).json({ error: 'Producer not found.' })
  const [milk, feed, advances, payments] = await Promise.all([
    pool.query(
      `SELECT COALESCE(session_date, collected_at::date)::text AS date,
              COALESCE(session_type, CASE WHEN EXTRACT(HOUR FROM collected_at) < 12 THEN 'MORNING' ELSE 'EVENING' END) AS session_type,
              milk_type, sum(quantity_litres) AS quantity, sum(amount) AS amount
       FROM milk_entries
       WHERE dairy_id = $1 AND producer_id = $2
         AND COALESCE(session_date, collected_at::date) BETWEEN $3::date AND $4::date
       GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
      [dairyId, producerId, from, to],
    ),
    pool.query(
      `SELECT id, issue_date AS date, feed_name_snapshot AS description,
              quantity, unit, rate_per_unit AS rate, amount
       FROM feed_issues WHERE dairy_id = $1 AND producer_id = $2 AND issue_date BETWEEN $3::date AND $4::date
       ORDER BY issue_date, created_at`,
      [dairyId, producerId, from, to],
    ),
    pool.query(
      `SELECT id, advance_date AS date, 'Advance' AS description, amount, voided_at
       FROM producer_advances WHERE dairy_id = $1 AND producer_id = $2 AND advance_date BETWEEN $3::date AND $4::date
       ORDER BY advance_date, created_at`,
      [dairyId, producerId, from, to],
    ),
    pool.query(
      `SELECT id, payment_date AS date, 'Payment' AS description, amount
       FROM producer_payments WHERE dairy_id = $1 AND producer_id = $2 AND payment_date BETWEEN $3::date AND $4::date
       ORDER BY payment_date, created_at`,
      [dairyId, producerId, from, to],
    ),
  ])
  const sum = (rows, key = 'amount') => rows.reduce((total, row) => total + Number(row[key] || 0), 0)
  const activeAdvances = advances.rows.filter((row) => !row.voided_at)
  const totals = {
    quantity: milk.rows.reduce((total, row) => total + Number(row.quantity || 0), 0),
    milkAmount: sum(milk.rows),
    feedAmount: sum(feed.rows),
    advanceAmount: sum(activeAdvances),
    paymentAmount: sum(payments.rows),
  }
  totals.balance = totals.milkAmount - totals.feedAmount - totals.advanceAmount - totals.paymentAmount
  res.json({
    producer: producerRow(producerResult.rows[0]),
    days: milk.rows,
    feedIssues: feed.rows,
    advances: advances.rows,
    payments: payments.rows,
    totals,
    from,
    to,
  })
})

app.get('/api/private/producer-balances', async (req, res) => {
  const result = await pool.query(
    `SELECT p.id, p.producer_code, p.name,
       COALESCE(m.amount, 0) - COALESCE(f.amount, 0) - COALESCE(a.amount, 0) - COALESCE(pm.amount, 0) AS balance
     FROM producers p
     LEFT JOIN (
       SELECT producer_id, sum(amount) AS amount FROM milk_entries WHERE dairy_id = $1 GROUP BY producer_id
     ) m ON m.producer_id = p.id
     LEFT JOIN (
       SELECT producer_id, sum(amount) AS amount FROM feed_issues WHERE dairy_id = $1 GROUP BY producer_id
     ) f ON f.producer_id = p.id
     LEFT JOIN (
       SELECT producer_id, sum(amount) AS amount FROM producer_advances
       WHERE dairy_id = $1 AND voided_at IS NULL GROUP BY producer_id
     ) a ON a.producer_id = p.id
     LEFT JOIN (
       SELECT producer_id, sum(amount) AS amount FROM producer_payments WHERE dairy_id = $1 GROUP BY producer_id
     ) pm ON pm.producer_id = p.id
     WHERE p.dairy_id = $1 AND p.is_active = true
     ORDER BY p.name`,
    [req.membership.dairy_id],
  )
  res.json({ items: result.rows })
})

app.get('/api/private/reports/bills', async (req, res) => {
  const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.month)
  const result = await pool.query(
    `WITH milk AS (
       SELECT producer_id, sum(quantity_litres) AS quantity, sum(amount) AS amount
       FROM milk_entries
       WHERE dairy_id = $1
         AND COALESCE(session_date, collected_at::date) >= $2::date
         AND COALESCE(session_date, collected_at::date) < ($2::date + interval '1 month')
       GROUP BY producer_id
     ), feed AS (
       SELECT producer_id, sum(amount) AS amount FROM feed_issues
       WHERE dairy_id = $1 AND issue_date >= $2::date AND issue_date < ($2::date + interval '1 month')
       GROUP BY producer_id
     ), advances AS (
       SELECT producer_id, sum(amount) AS amount FROM producer_advances
       WHERE dairy_id = $1 AND advance_date >= $2::date AND advance_date < ($2::date + interval '1 month')
         AND voided_at IS NULL
       GROUP BY producer_id
     ), payments AS (
       SELECT producer_id, sum(amount) AS amount FROM producer_payments
       WHERE dairy_id = $1 AND payment_date >= $2::date AND payment_date < ($2::date + interval '1 month')
       GROUP BY producer_id
     )
     SELECT p.id, p.producer_code, p.name,
       COALESCE(m.quantity, 0) AS quantity_litres,
       COALESCE(m.amount, 0) AS milk_amount,
       COALESCE(a.amount, 0) AS advance_amount,
       COALESCE(f.amount, 0) AS feed_amount,
       COALESCE(m.amount, 0) - COALESCE(a.amount, 0) - COALESCE(f.amount, 0) AS net_payable,
       COALESCE(pm.amount, 0) AS payment_amount,
       COALESCE(m.amount, 0) - COALESCE(a.amount, 0) - COALESCE(f.amount, 0) - COALESCE(pm.amount, 0) AS balance_due
     FROM producers p
     LEFT JOIN milk m ON m.producer_id = p.id
     LEFT JOIN feed f ON f.producer_id = p.id
     LEFT JOIN advances a ON a.producer_id = p.id
     LEFT JOIN payments pm ON pm.producer_id = p.id
     WHERE p.dairy_id = $1 AND p.is_active = true
     ORDER BY p.producer_code`,
    [req.membership.dairy_id, `${month}-01`],
  )
  const totals = result.rows.reduce((sum, row) => ({
    quantity: sum.quantity.plus(row.quantity_litres),
    milkAmount: sum.milkAmount.plus(row.milk_amount),
    advanceAmount: sum.advanceAmount.plus(row.advance_amount),
    feedAmount: sum.feedAmount.plus(row.feed_amount),
    netPayable: sum.netPayable.plus(row.net_payable),
    paymentAmount: sum.paymentAmount.plus(row.payment_amount),
    balanceDue: sum.balanceDue.plus(row.balance_due),
  }), {
    quantity: new Decimal(0), milkAmount: new Decimal(0), advanceAmount: new Decimal(0),
    feedAmount: new Decimal(0), netPayable: new Decimal(0), paymentAmount: new Decimal(0),
    balanceDue: new Decimal(0),
  })
  res.json({
    items: result.rows,
    totals: {
      quantity: totals.quantity.toFixed(3),
      milkAmount: totals.milkAmount.toFixed(2),
      advanceAmount: totals.advanceAmount.toFixed(2),
      feedAmount: totals.feedAmount.toFixed(2),
      netPayable: totals.netPayable.toFixed(2),
      paymentAmount: totals.paymentAmount.toFixed(2),
      balanceDue: totals.balanceDue.toFixed(2),
    },
    month,
  })
})

app.get('/api/private/rate-rules', async (req, res) => {
  const result = await pool.query(
    `SELECT id, milk_type, effective_from, fat_min, fat_max, snf_min, snf_max, rate_per_litre
     FROM milk_rate_rules WHERE dairy_id = $1 ORDER BY effective_from DESC, milk_type, fat_min`,
    [req.membership.dairy_id],
  )
  res.json({ items: result.rows })
})

function parseRateChartMatrix(matrix) {
  const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
  const numeric = (value) => {
    const text = String(value ?? '').replace(/[,%₹\s]/g, '')
    return text ? Number(text) : Number.NaN
  }
  const headerIndex = matrix.findIndex((row) => row.some((cell) => {
    const header = normalize(cell)
    return ['fat', 'fatpercent', 'fatpercentage'].includes(header)
  }))
  if (headerIndex < 0) {
    throw new Error('Could not find a Fat column in the file. Add columns named Fat, SNF, and Rate, or enter rate rows manually.')
  }
  const headers = matrix[headerIndex].map(normalize)
  const fatIndex = headers.findIndex((value) => ['fat', 'fatpercent', 'fatpercentage', 'fatmin'].includes(value))
  const snfIndex = headers.findIndex((value) => ['snf', 'snfpercent', 'snfpercentage', 'snfmin'].includes(value))
  const rateIndex = headers.findIndex((value) => ['rate', 'rateperlitre', 'rateperliter', 'milkrate', 'price'].includes(value))
  const fatMaxIndex = headers.indexOf('fatmax')
  const snfMaxIndex = headers.indexOf('snfmax')
  const rates = []

  if (snfIndex >= 0 && rateIndex >= 0) {
    for (const row of matrix.slice(headerIndex + 1)) {
      const fat = numeric(row[fatIndex])
      const snf = numeric(row[snfIndex])
      const rate = numeric(row[rateIndex])
      if (![fat, snf, rate].every(Number.isFinite)) continue
      rates.push({
        fatMin: fat,
        fatMax: fatMaxIndex >= 0 && numeric(row[fatMaxIndex]) > fat ? numeric(row[fatMaxIndex]) : Math.min(fat + 0.01, 20),
        snfMin: snf,
        snfMax: snfMaxIndex >= 0 && numeric(row[snfMaxIndex]) > snf ? numeric(row[snfMaxIndex]) : Math.min(snf + 0.01, 20),
        ratePerLitre: rate,
      })
    }
  } else {
    const snfColumns = matrix[headerIndex].map((cell, index) => ({ index, value: numeric(cell) }))
      .filter(({ index, value }) => index !== fatIndex && Number.isFinite(value) && value >= 0 && value <= 20)
    for (const row of matrix.slice(headerIndex + 1)) {
      const fat = numeric(row[fatIndex])
      if (!Number.isFinite(fat)) continue
      for (let index = 0; index < snfColumns.length; index += 1) {
        const { index: rateColumn, value: snf } = snfColumns[index]
        const rate = numeric(row[rateColumn])
        if (!Number.isFinite(rate)) continue
        rates.push({
          fatMin: fat,
          fatMax: Math.min(fat + 0.01, 20),
          snfMin: snf,
          snfMax: Math.min(snf + 0.01, 20),
          ratePerLitre: rate,
        })
      }
    }
  }
  if (!rates.length) {
    throw new Error('No complete Fat, SNF, and rate rows were found. Check the first row for Fat, SNF, and Rate column names.')
  }
  return rates
}

app.post('/api/private/rate-rules/import-preview', requireOwner, chartUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a CSV, XLSX, or text-based PDF rate chart.' })
  const extension = path.extname(req.file.originalname).toLowerCase()
  let matrix
  let importedRows
  let suggestedEffectiveFrom = null
  if (extension === '.csv') {
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '')
    const rows = []
    let row = []
    let value = ''
    let quoted = false
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]
      if (character === '"' && quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = !quoted
      } else if (character === ',' && !quoted) {
        row.push(value.trim())
        value = ''
      } else if ((character === '\n' || character === '\r') && !quoted) {
        row.push(value.trim())
        if (row.some(Boolean)) rows.push(row)
        row = []
        value = ''
        if (character === '\r' && text[index + 1] === '\n') index += 1
      } else {
        value += character
      }
    }
    row.push(value.trim())
    if (row.some(Boolean)) rows.push(row)
    matrix = rows
  } else if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(req.file.buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return res.status(422).json({ error: 'The Excel file has no worksheet.' })
    matrix = []
    worksheet.eachRow({ includeEmpty: false }, (row) => matrix.push(row.values.slice(1).map((cell) => (
      cell && typeof cell === 'object' && 'text' in cell ? cell.text : cell
    ))))
  } else if (extension === '.pdf') {
    const document = await pdfjs.getDocument({
      data: new Uint8Array(req.file.buffer),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise
    const pages = []
    const allText = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageItems = []
      for (const item of content.items) {
        if (!item.str?.trim()) continue
        pageItems.push({ x: item.transform[4], y: item.transform[5], text: item.str })
        allText.push(item.str)
      }
      pages.push(pageItems)
    }
    try {
      importedRows = parsePdfRateChartPages(pages)
      suggestedEffectiveFrom = extractPdfEffectiveDate(allText.join(' '))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Could not recognize')) {
        return res.status(422).json({ error: error.message })
      }
      throw error
    }
  } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    return res.status(415).json({
      error: 'Image OCR is not configured. Add the chart manually or convert it to CSV/Excel/text-based PDF to preview the extracted rates.',
    })
  } else {
    return res.status(415).json({ error: 'Supported imports are CSV, XLSX, and text-based PDF. Legacy XLS and image OCR are not available.' })
  }
  try {
    const rows = importedRows || parseRateChartMatrix(matrix)
    res.json({
      rows,
      sourceName: path.basename(req.file.originalname),
      extraction: extension === '.pdf' ? 'matrix' : 'table',
      ...(suggestedEffectiveFrom ? { suggestedEffectiveFrom } : {}),
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Could not find') || error instanceof Error && error.message.startsWith('No complete')) {
      return res.status(422).json({ error: error.message })
    }
    throw error
  }
})

app.post('/api/private/rate-rules/import', requireOwner, async (req, res) => {
  const parsed = z.object({
    milkType: z.enum(['COW', 'BUFFALO']),
    effectiveFrom: z.iso.date(),
    rows: z.array(z.object({
      fatMin: z.coerce.number().min(0).max(20).multipleOf(0.01),
      fatMax: z.coerce.number().gt(0).max(20).multipleOf(0.01),
      snfMin: z.coerce.number().min(0).max(20).multipleOf(0.01),
      snfMax: z.coerce.number().gt(0).max(20).multipleOf(0.01),
      ratePerLitre: z.coerce.number().min(0).max(100000).multipleOf(0.0001),
    }).refine((value) => value.fatMax > value.fatMin && value.snfMax > value.snfMin), {
      min: 1,
      max: 2000,
    }),
  }).safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Check the imported rate rows. Fat/SNF ranges must increase and the rate must be a valid amount.',
      details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    })
  }
  const { milkType, effectiveFrom, rows } = parsed.data
  for (let index = 0; index < rows.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < rows.length; otherIndex += 1) {
      const a = rows[index]
      const b = rows[otherIndex]
      if (a.fatMin < b.fatMax && a.fatMax > b.fatMin
          && a.snfMin < b.snfMax && a.snfMax > b.snfMin) {
        return res.status(409).json({ error: `Imported rows ${index + 1} and ${otherIndex + 1} overlap.` })
      }
    }
  }
  const result = await inTransaction(async (client) => {
    const saved = []
    for (const row of rows) {
      const overlap = await client.query(
        `SELECT 1 FROM milk_rate_rules
         WHERE dairy_id = $1 AND milk_type = $2 AND effective_from = $3
           AND fat_min < $4 AND fat_max > $5 AND snf_min < $6 AND snf_max > $7`,
        [req.membership.dairy_id, milkType, effectiveFrom, row.fatMax, row.fatMin, row.snfMax, row.snfMin],
      )
      if (overlap.rowCount) throw Object.assign(new Error('Imported rate rows overlap an existing rate chart.'), { status: 409 })
      const inserted = await client.query(
        `INSERT INTO milk_rate_rules
           (dairy_id, milk_type, effective_from, fat_min, fat_max, snf_min, snf_max, rate_per_litre)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, milk_type, effective_from, fat_min, fat_max, snf_min, snf_max, rate_per_litre`,
        [req.membership.dairy_id, milkType, effectiveFrom, row.fatMin, row.fatMax,
          row.snfMin, row.snfMax, row.ratePerLitre],
      )
      await audit(req, 'IMPORT', 'milk_rate_rule', inserted.rows[0].id, client)
      saved.push(inserted.rows[0])
    }
    return saved
  }).catch((error) => {
    if (error.status === 409) return { error: error.message }
    throw error
  })
  if (result?.error) return res.status(409).json({ error: result.error })
  res.status(201).json({ items: result })
})

app.post('/api/private/rate-rules', requireOwner, parseBody(ruleSchema), async (req, res) => {
  const data = req.validated
  const overlap = await pool.query(
    `SELECT 1 FROM milk_rate_rules
     WHERE dairy_id = $1 AND milk_type = $2 AND effective_from = $3
       AND fat_min < $4 AND fat_max > $5 AND snf_min < $6 AND snf_max > $7`,
    [req.membership.dairy_id, data.milkType, data.effectiveFrom, data.fatMax, data.fatMin,
      data.snfMax, data.snfMin],
  )
  if (overlap.rowCount) {
    return res.status(409).json({ error: 'This Fat/SNF slab overlaps another rule for the same milk type and effective date.' })
  }
  const result = await pool.query(
    `INSERT INTO milk_rate_rules
      (dairy_id, milk_type, effective_from, fat_min, fat_max, snf_min, snf_max, rate_per_litre)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, milk_type, effective_from, fat_min, fat_max, snf_min, snf_max, rate_per_litre`,
    [req.membership.dairy_id, data.milkType, data.effectiveFrom, data.fatMin, data.fatMax,
      data.snfMin, data.snfMax, data.ratePerLitre],
  )
  await audit(req, 'CREATE', 'milk_rate_rule', result.rows[0].id)
  res.status(201).json({ item: result.rows[0] })
})
app.put('/api/private/rate-rules/:id', requireOwner, parseBody(ruleSchema), async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const data = req.validated
  const overlap = await pool.query(
    `SELECT 1 FROM milk_rate_rules
     WHERE dairy_id = $1 AND milk_type = $2 AND effective_from = $3 AND id <> $8
       AND fat_min < $4 AND fat_max > $5 AND snf_min < $6 AND snf_max > $7`,
    [req.membership.dairy_id, data.milkType, data.effectiveFrom, data.fatMax, data.fatMin,
      data.snfMax, data.snfMin, id],
  )
  if (overlap.rowCount) {
    return res.status(409).json({ error: 'This Fat/SNF slab overlaps another rule for the same milk type and effective date.' })
  }
  const result = await pool.query(
    `UPDATE milk_rate_rules SET milk_type = $1, effective_from = $2, fat_min = $3,
      fat_max = $4, snf_min = $5, snf_max = $6, rate_per_litre = $7
     WHERE id = $8 AND dairy_id = $9
     RETURNING id, milk_type, effective_from, fat_min, fat_max, snf_min, snf_max, rate_per_litre`,
    [data.milkType, data.effectiveFrom, data.fatMin, data.fatMax, data.snfMin,
      data.snfMax, data.ratePerLitre, id, req.membership.dairy_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Rate rule not found.' })
  await audit(req, 'UPDATE', 'milk_rate_rule', id)
  res.json({ item: result.rows[0] })
})
app.delete('/api/private/rate-rules/:id', requireOwner, async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await pool.query(
    'DELETE FROM milk_rate_rules WHERE id = $1 AND dairy_id = $2 RETURNING id',
    [id, req.membership.dairy_id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Rate rule not found.' })
  await audit(req, 'DELETE', 'milk_rate_rule', id)
  res.status(204).end()
})

async function saveMilkEntry(req, res, id) {
  const data = req.validated
  const dairyId = req.membership.dairy_id
  const collectedAt = new Date(data.collectedAt)
  const outcome = await inTransaction(async (client) => {
    const collectionSession = await client.query(
      `SELECT id, status FROM collection_sessions
       WHERE dairy_id = $1 AND session_date = $2 AND session_type = $3
       FOR UPDATE`,
      [dairyId, data.sessionDate, data.sessionType],
    )
    if (!collectionSession.rowCount) {
      return { status: 409, error: 'Start this collection session before recording milk.' }
    }
    if (collectionSession.rows[0].status !== 'OPEN') {
      return { status: 409, error: 'This collection session is closed. Reopen it before making corrections.' }
    }

    if (id) {
      const existingEntry = await client.query(
        `SELECT session_date::text AS session_date, session_type FROM milk_entries
         WHERE dairy_id = $1 AND id = $2 FOR UPDATE`,
        [dairyId, id],
      )
      if (!existingEntry.rowCount) return { status: 404, error: 'Milk entry not found.' }
      if (existingEntry.rows[0].session_date !== data.sessionDate
          || existingEntry.rows[0].session_type !== data.sessionType) {
        return { status: 422, error: 'A milk entry cannot be moved to another date or session.' }
      }
    }

    const producer = await client.query(
      'SELECT id, producer_code, name, is_active FROM producers WHERE id = $1 AND dairy_id = $2',
      [data.producerId, dairyId],
    )
    if (!producer.rowCount) return { status: 404, error: 'Producer not found.' }
    if (!id && !producer.rows[0].is_active) {
      return { status: 409, error: 'This producer is inactive and cannot receive a new milk entry.' }
    }

    const rules = data.noSupply ? { rows: [] } : await client.query(
      `SELECT id, rate_per_litre FROM milk_rate_rules
       WHERE dairy_id = $1 AND milk_type = $2 AND effective_from <= $3::date
         AND fat_min <= $4 AND fat_max > $4 AND snf_min <= $5 AND snf_max > $5
       ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
      [dairyId, data.milkType, data.sessionDate, data.fat, data.snf],
    )
    if (!data.noSupply && !rules.rowCount) {
      return {
        status: 422,
        error: 'No matching rate is configured for this milk type, Fat, SNF, and collection date. Set up a rate rule first.',
      }
    }

    let calculated
    try {
      calculated = data.noSupply
        ? { quantity: new Decimal(0), rate: new Decimal(0), amount: new Decimal(0) }
        : calculateMilkAmounts(data.startReading, data.endReading, rules.rows[0].rate_per_litre)
    } catch (error) {
      if (error instanceof RangeError) return { status: 422, error: error.message }
      throw error
    }
    const { quantity, rate, amount } = calculated
    const values = [
      dairyId, producer.rows[0].id, producer.rows[0].producer_code, producer.rows[0].name,
      collectedAt.toISOString(), data.milkType, data.startReading, data.endReading,
      quantity.toFixed(3), data.fat, data.snf, rate.toFixed(4), amount.toFixed(2),
      rules.rows[0]?.id || null, data.notes, data.sessionDate, data.sessionType,
    ]

    let result
    if (id) {
      result = await client.query(
        `UPDATE milk_entries SET
          producer_id = $2, producer_code_snapshot = $3, producer_name_snapshot = $4,
          collected_at = $5, milk_type = $6, start_reading = $7, end_reading = $8,
          quantity_litres = $9, fat = $10, snf = $11, rate_per_litre = $12,
          amount = $13, rate_rule_id = $14, notes = $15, session_date = $16,
          session_type = $17, updated_at = now()
         WHERE dairy_id = $1 AND id = $18
         RETURNING id, producer_id, producer_code_snapshot, producer_name_snapshot,
           collected_at, milk_type, start_reading, end_reading, quantity_litres,
           fat, snf, rate_per_litre, amount, notes, session_date, session_type`,
        [...values, id],
      )
      if (!result.rowCount) return { status: 404, error: 'Milk entry not found.' }
      await audit(req, 'UPDATE', 'milk_entry', id, client)
      return { status: 200, item: result.rows[0] }
    }
    result = await client.query(
      `INSERT INTO milk_entries
        (dairy_id, producer_id, producer_code_snapshot, producer_name_snapshot,
         collected_at, milk_type, start_reading, end_reading, quantity_litres,
         fat, snf, rate_per_litre, amount, rate_rule_id, notes, session_date, session_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id, producer_id, producer_code_snapshot, producer_name_snapshot,
         collected_at, milk_type, start_reading, end_reading, quantity_litres,
         fat, snf, rate_per_litre, amount, notes, session_date, session_type`,
      values,
    )
    await audit(req, 'CREATE', 'milk_entry', result.rows[0].id, client)
    return { status: 201, item: result.rows[0] }
  })

  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error })
  res.status(outcome.status).json({ item: outcome.item })
}

app.post('/api/private/milk-quote', parseBody(milkQuoteSchema), async (req, res) => {
  const data = req.validated
  if (data.noSupply) {
    return res.json({ quantity: '0.000', rate: '0.0000', amount: '0.00', noSupply: true })
  }
  if (data.endReading <= data.startReading) {
    return res.status(422).json({ error: 'End reading must be greater than start reading.' })
  }
  const dairyId = req.membership.dairy_id
  const rule = await pool.query(
    `SELECT rate_per_litre FROM milk_rate_rules
     WHERE dairy_id = $1 AND milk_type = $2 AND effective_from <= $3::date
       AND fat_min <= $4 AND fat_max > $4 AND snf_min <= $5 AND snf_max > $5
     ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
    [dairyId, data.milkType, data.sessionDate, data.fat, data.snf],
  )
  if (!rule.rowCount) {
    return res.status(422).json({
      error: 'No matching rate chart row was found for this milk type, Fat, SNF, and date.',
    })
  }
  try {
    const calculation = calculateMilkAmounts(data.startReading, data.endReading, rule.rows[0].rate_per_litre)
    return res.json({
      quantity: calculation.quantity.toFixed(3),
      rate: calculation.rate.toFixed(4),
      amount: calculation.amount.toFixed(2),
      noSupply: false,
    })
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return res.status(422).json({ error: error.message })
  }
})

app.get('/api/private/milk-entries', async (req, res) => {
  const { page, limit, search } = pageSchema.parse(req.query)
  const filters = ['dairy_id = $1']
  const params = [req.membership.dairy_id]
  if (req.query.from) {
    params.push(z.iso.date().parse(req.query.from))
    filters.push(`COALESCE(session_date, collected_at::date) >= $${params.length}::date`)
  }
  if (req.query.to) {
    params.push(z.iso.date().parse(req.query.to))
    filters.push(`COALESCE(session_date, collected_at::date) <= $${params.length}::date`)
  }
  if (req.query.milkType) {
    params.push(z.enum(['COW', 'BUFFALO']).parse(req.query.milkType))
    filters.push(`milk_type = $${params.length}`)
  }
  if (req.query.sessionType) {
    params.push(z.enum(['MORNING', 'EVENING']).parse(req.query.sessionType))
    filters.push(`session_type = $${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    filters.push(`(producer_code_snapshot ILIKE $${params.length} OR producer_name_snapshot ILIKE $${params.length})`)
  }
  const where = filters.join(' AND ')
  const [items, count] = await Promise.all([
    pool.query(
      `SELECT id, producer_id, producer_code_snapshot AS producer_code,
        producer_name_snapshot AS producer_name, collected_at, milk_type, start_reading,
        end_reading, quantity_litres, fat, snf, rate_per_litre, amount, notes,
        session_date, session_type
       FROM milk_entries WHERE ${where} ORDER BY collected_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    ),
    pool.query(`SELECT count(*)::int AS total FROM milk_entries WHERE ${where}`, params),
  ])
  res.json({ items: items.rows, total: count.rows[0].total, page, limit })
})
app.get('/api/private/milk-entries/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await pool.query(
    `SELECT id, producer_id, producer_code_snapshot AS producer_code,
      producer_name_snapshot AS producer_name, collected_at, milk_type, start_reading,
      end_reading, quantity_litres, fat, snf, rate_per_litre, amount, notes,
      session_date, session_type
     FROM milk_entries WHERE dairy_id = $1 AND id = $2`,
    [req.membership.dairy_id, id],
  )
  if (!result.rowCount) return res.status(404).json({ error: 'Milk entry not found.' })
  res.json({ item: result.rows[0] })
})
app.post('/api/private/milk-entries', requireOwner, parseBody(milkSchema), (req, res) => saveMilkEntry(req, res))
app.put('/api/private/milk-entries/:id', requireOwner, parseBody(milkSchema), (req, res) => {
  return saveMilkEntry(req, res, idSchema.parse(req.params.id))
})
app.delete('/api/private/milk-entries/:id', requireOwner, async (req, res) => {
  const id = idSchema.parse(req.params.id)
  const result = await inTransaction(async (client) => {
    const entry = await client.query(
      `SELECT session_date, session_type FROM milk_entries
       WHERE id = $1 AND dairy_id = $2`,
      [id, req.membership.dairy_id],
    )
    if (!entry.rowCount) return { status: 404, error: 'Milk entry not found.' }
    const session = await client.query(
      `SELECT status FROM collection_sessions
       WHERE dairy_id = $1 AND session_date = $2 AND session_type = $3 FOR UPDATE`,
      [req.membership.dairy_id, entry.rows[0].session_date, entry.rows[0].session_type],
    )
    if (!session.rowCount || session.rows[0].status !== 'OPEN') {
      return { status: 409, error: 'Reopen this collection session before correcting or deleting entries.' }
    }
    const lockedEntry = await client.query(
      `SELECT 1 FROM milk_entries WHERE id = $1 AND dairy_id = $2 FOR UPDATE`,
      [id, req.membership.dairy_id],
    )
    if (!lockedEntry.rowCount) return { status: 404, error: 'Milk entry not found.' }
    await client.query('DELETE FROM milk_entries WHERE id = $1 AND dairy_id = $2', [id, req.membership.dairy_id])
    await audit(req, 'DELETE', 'milk_entry', id, client)
    return { status: 204 }
  })
  if (result.error) return res.status(result.status).json({ error: result.error })
  res.status(204).end()
})

app.get('/api/private/reports/milk', async (req, res) => {
  const from = z.iso.date().parse(req.query.from)
  const to = z.iso.date().parse(req.query.to)
  const groupBy = z.enum(['entries', 'date', 'producer', 'type']).default('entries').parse(req.query.groupBy)
  if (from > to) return res.status(400).json({ error: 'The start date must be on or before the end date.' })
  const queryByGroup = {
    entries: `SELECT COALESCE(session_date, collected_at::date) AS date, milk_type,
      producer_code_snapshot AS producer_code, producer_name_snapshot AS producer_name,
      quantity_litres, rate_per_litre, amount
      FROM milk_entries WHERE dairy_id = $1
        AND COALESCE(session_date, collected_at::date) >= $2::date
        AND COALESCE(session_date, collected_at::date) <= $3::date
      ORDER BY date, producer_name_snapshot`,
    date: `SELECT COALESCE(session_date, collected_at::date) AS date, sum(quantity_litres) AS quantity_litres,
      sum(amount) AS amount, count(*)::int AS entries
      FROM milk_entries WHERE dairy_id = $1
        AND COALESCE(session_date, collected_at::date) >= $2::date
        AND COALESCE(session_date, collected_at::date) <= $3::date
      GROUP BY COALESCE(session_date, collected_at::date) ORDER BY date`,
    producer: `SELECT producer_code_snapshot AS producer_code,
      producer_name_snapshot AS producer_name, sum(quantity_litres) AS quantity_litres,
      sum(amount) AS amount, count(*)::int AS entries
      FROM milk_entries WHERE dairy_id = $1
        AND COALESCE(session_date, collected_at::date) >= $2::date
        AND COALESCE(session_date, collected_at::date) <= $3::date
      GROUP BY producer_code_snapshot, producer_name_snapshot ORDER BY producer_name`,
    type: `SELECT milk_type, sum(quantity_litres) AS quantity_litres,
      sum(amount) AS amount, count(*)::int AS entries
      FROM milk_entries WHERE dairy_id = $1
        AND COALESCE(session_date, collected_at::date) >= $2::date
        AND COALESCE(session_date, collected_at::date) <= $3::date
      GROUP BY milk_type ORDER BY milk_type`,
  }
  const reportGroup = req.query.format === 'csv' ? 'entries' : groupBy
  const result = await pool.query(
    queryByGroup[reportGroup],
    [req.membership.dairy_id, from, to],
  )
  const rows = result.rows
  if (req.query.format === 'csv') {
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const csvRows = [
      ['Date', 'Milk type', 'Producer code', 'Producer', 'Quantity (L)', 'Rate/L', 'Amount'],
      ...rows.map((row) => [
        row.date.toISOString().slice(0, 10), row.milk_type, row.producer_code, row.producer_name,
        row.quantity_litres, row.rate_per_litre, row.amount,
      ]),
    ]
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="milk-report.csv"')
      .send(csvRows.map((row) => row.map(quote).join(',')).join('\r\n'))
    return
  }
  const totals = rows.reduce((aggregate, row) => ({
    quantity: aggregate.quantity.plus(row.quantity_litres),
    amount: aggregate.amount.plus(row.amount),
  }), { quantity: new Decimal(0), amount: new Decimal(0) })
  res.json({
    items: rows,
    groupBy,
    totals: { quantity: totals.quantity.toFixed(3), amount: totals.amount.toFixed(2) },
  })
})

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }))

app.use((error, req, res, next) => {
  void next
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: 'Invalid request parameters.' })
  }
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maximum = req.path.endsWith('/photo') || req.path.endsWith('/register') ? '2 MB' : '8 MB'
      return res.status(413).json({ error: `Uploaded file exceeds the ${maximum} limit.` })
    }
    return res.status(400).json({ error: 'Upload a single file using the expected file field.' })
  }
  if (error.code === '23505') {
    if (error.constraint === 'milk_entries_session_producer_unique') {
      return res.status(409).json({ error: 'This producer already has an entry for that milk type in this session. Edit the existing entry instead.' })
    }
    return res.status(409).json({ error: 'That code is already in use for this dairy.' })
  }
  if (error.code === '23503') {
    return res.status(409).json({ error: 'This record is in use and cannot be removed.' })
  }
  console.error('Request failed:', error.message)
  res.status(500).json({ error: 'The request could not be completed. Please try again.' })
})

export default app
