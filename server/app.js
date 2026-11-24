import express from 'express'
import { MongoClient } from 'mongodb'
import dotenv from 'dotenv'
import cors from 'cors'
import session from 'express-session'
import MongoStore from 'connect-mongo'
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { randomUUID } from 'node:crypto'
import crypto from 'node:crypto'
import dns from 'node:dns'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: './server/.env' })

const dnsServers =
  process.env.DNS_SERVERS?.split(',').map((server) => server.trim()).filter(Boolean) || ['1.1.1.1', '8.8.8.8']

const isProduction = process.env.NODE_ENV === 'production'
const port = Number.parseInt(process.env.PORT || '4000', 10)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.resolve(__dirname, '../dist')

function toOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return parsed.origin
  } catch {
    return null
  }
}

function expandOriginVariants(origin) {
  if (typeof origin !== 'string' || !origin.trim()) {
    return []
  }

  try {
    const parsed = new URL(origin)
    const variants = new Set([parsed.origin])

    if (parsed.hostname.startsWith('www.')) {
      variants.add(`${parsed.protocol}//${parsed.hostname.slice(4)}${parsed.port ? `:${parsed.port}` : ''}`)
    } else {
      variants.add(`${parsed.protocol}//www.${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`)
    }

    return [...variants]
  } catch {
    return [origin]
  }
}

function normalizeBasePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }

  const trimmed = value.trim()
  if (trimmed === '/') {
    return ''
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

try {
  dns.setServers(dnsServers)
} catch (error) {
  console.warn('Unable to apply custom DNS servers.', error)
}

const frontendUrl = process.env.FRONTEND_URL || 'https://robovore.com/marik'
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || `${frontendUrl}/auth/google/callback`
const frontendOrigin = toOrigin(frontendUrl)
const callbackOrigin = toOrigin(googleCallbackUrl)
const useCrossSiteCookies = Boolean(
  isProduction && frontendOrigin && callbackOrigin && frontendOrigin !== callbackOrigin,
)
const configuredBasePath = normalizeBasePath(process.env.APP_BASE_PATH || '')
const frontendPathFromUrl = (() => {
  try {
    const parsed = new URL(frontendUrl)
    return normalizeBasePath(parsed.pathname)
  } catch {
    return ''
  }
})()
const appBasePath = configuredBasePath || frontendPathFromUrl
const app = express()
app.set('trust proxy', 1)
const additionalOrigins = process.env.ADDITIONAL_CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) || []
const originSeeds = [toOrigin(frontendUrl), ...additionalOrigins.map(toOrigin)].filter(Boolean)
const allowedOrigins = [...new Set(originSeeds.flatMap((origin) => expandOriginVariants(origin)))].filter(Boolean)

if (appBasePath) {
  app.use((req, _res, next) => {
    if (req.url === appBasePath) {
      req.url = '/'
      return next()
    }

    if (req.url.startsWith(`${appBasePath}/`)) {
      req.url = req.url.slice(appBasePath.length) || '/'
    }

    return next()
  })
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }

      return callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
  }),
)
app.use(express.json())

const mongoUri = process.env.MONGODB_URI || process.env.ATLAS_URI || ''
const mongoUriDirect = process.env.MONGODB_URI_DIRECT || process.env.ATLAS_URI_DIRECT || ''
const mongoDbName = process.env.MONGODB_DB || process.env.MONGO_DB || undefined

if (!mongoUri && !mongoUriDirect) {
  throw new Error('Missing MongoDB URI. Set MONGODB_URI (or ATLAS_URI).')
}

let client

try {
  if (!mongoUri) {
    throw new Error('Primary MongoDB URI is not configured.')
  }

  client = new MongoClient(mongoUri)
  await client.connect()
} catch (primaryError) {
  if (!mongoUriDirect) {
    throw primaryError
  }

  console.warn('Primary MongoDB SRV connection failed. Retrying with direct URI fallback.')
  client = new MongoClient(mongoUriDirect)
  await client.connect()
}

const db = client.db(mongoDbName)
const comments = db.collection('comments')
const clubs = db.collection('clubs')
const books = db.collection('books')
const clubMembers = db.collection('clubMembers')
const users = db.collection('users')
const sessionStore = MongoStore.create({
  client,
  dbName: db.databaseName,
  collectionName: process.env.SESSION_COLLECTION_NAME || 'sessions',
  ttl: 60 * 60 * 24 * 14,
  stringify: false,
})

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fabil-dev-session-secret',
    proxy: true,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      // Cross-site frontend/backend auth requires SameSite=None + Secure cookies.
      sameSite: useCrossSiteCookies ? 'none' : 'lax',
      secure: isProduction,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  }),
)
app.use(passport.initialize())
app.use(passport.session())

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const authEnabled = Boolean(googleClientId && googleClientSecret)
const callbackUrl = googleCallbackUrl
const authTokenSecret = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET || 'fabil-dev-session-secret'

function createAuthToken(googleId) {
  const payload = {
    googleId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14,
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', authTokenSecret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

function verifyAuthToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return null
  }

  const [encodedPayload, providedSignature] = token.split('.')
  if (!encodedPayload || !providedSignature) {
    return null
  }

  const expectedSignature = crypto.createHmac('sha256', authTokenSecret).update(encodedPayload).digest('base64url')
  const provided = Buffer.from(providedSignature)
  const expected = Buffer.from(expectedSignature)

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!payload?.googleId || typeof payload.googleId !== 'string') {
      return null
    }

    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

function sanitizeFrontendUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    const basePath = normalizedPath === '/' ? '' : normalizedPath
    return `${parsed.origin}${basePath}`
  } catch {
    return null
  }
}

function resolveFrontendOrigin(req) {
  const fromQuery = sanitizeFrontendUrl(req.query?.frontendUrl)
  if (fromQuery) {
    return fromQuery
  }

  const referer = req.get('referer')
  const fromReferer = sanitizeFrontendUrl(referer)
  if (fromReferer) {
    return fromReferer
  }

  return frontendUrl
}

function toMemberId(displayName, email) {
  const normalizedName = (displayName ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  const normalizedEmail = (email ?? '').trim().toLowerCase()
  const basis = normalizedEmail || normalizedName || randomUUID()
  return `member-${basis.replace(/[^a-z0-9@._-]/g, '')}`
}

passport.serializeUser((user, done) => {
  done(null, user.googleId)
})

passport.deserializeUser(async (googleId, done) => {
  try {
    const user = await users.findOne({ googleId })
    done(null, user || null)
  } catch (error) {
    done(error)
  }
})

if (authEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
          callbackURL: callbackUrl,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value ?? ''
          const displayName = profile.displayName || email || 'Reader'
          const colorSeed = (profile.id?.charCodeAt(0) ?? 97) % 5
          const palette = ['#a56cc7', '#d16c7a', '#5d8fd1', '#4f9d69', '#b17d5d']
          const commentColor = palette[colorSeed]

          const update = {
            $set: {
              googleId: profile.id,
              email,
              displayName,
              avatarUrl: profile.photos?.[0]?.value ?? '',
              commentColor,
              updatedAt: new Date().toISOString(),
            },
            $setOnInsert: {
              createdAt: new Date().toISOString(),
            },
          }

          await users.updateOne({ googleId: profile.id }, update, { upsert: true })
          const user = await users.findOne({ googleId: profile.id })
          done(null, user)
        } catch (error) {
          done(error)
        }
      },
    ),
  )
}

app.get('/auth/google', (req, res, next) => {
  if (!authEnabled) {
    return res.status(503).json({ error: 'Google auth is not configured.' })
  }

  const frontendOrigin = resolveFrontendOrigin(req)

  req.session.oauthReturnTo = frontendOrigin

  return req.session.save((saveError) => {
    if (saveError) {
      return next(saveError)
    }

    return passport.authenticate('google', {
      scope: ['profile', 'email'],
      callbackURL: callbackUrl,
    })(req, res, next)
  })
})

app.get('/auth/google/callback', (req, res, next) => {
  if (!authEnabled) {
    return res.redirect(`${frontendUrl}?auth=disabled`)
  }

  const returnTo = sanitizeFrontendUrl(req.session?.oauthReturnTo) || frontendUrl

  return passport.authenticate('google', {
    failureRedirect: `${returnTo}?auth=failed`,
    callbackURL: callbackUrl,
  })(req, res, () => {
    if (req.session) {
      delete req.session.oauthReturnTo

      return req.session.save((saveError) => {
        if (saveError) {
          return next(saveError)
        }

        const successUrl = new URL(returnTo)
        successUrl.searchParams.set('auth', 'success')
        if (req.user?.googleId) {
          successUrl.searchParams.set('token', createAuthToken(req.user.googleId))
        }
        return res.redirect(successUrl.toString())
      })
    }

    const successUrl = new URL(returnTo)
    successUrl.searchParams.set('auth', 'success')
    if (req.user?.googleId) {
      successUrl.searchParams.set('token', createAuthToken(req.user.googleId))
    }
    return res.redirect(successUrl.toString())
  })
})

app.get('/auth/me', async (req, res) => {
  let user = req.user || null

  if (!user) {
    const header = req.get('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const payload = verifyAuthToken(token)

    if (payload?.googleId) {
      user = await users.findOne({ googleId: payload.googleId })
    }
  }

  if (!user) {
    return res.status(200).json({ authenticated: false })
  }

  return res.status(200).json({
    authenticated: true,
    user: {
      googleId: user.googleId,
      displayName: user.displayName,
      email: user.email ?? '',
      commentColor: user.commentColor ?? '#a56cc7',
      avatarUrl: user.avatarUrl ?? '',
    },
  })
})

app.post('/auth/logout', (req, res) => {
  req.logout((error) => {
    if (error) {
      return res.status(500).json({ error: 'Unable to log out.' })
    }

    req.session.destroy(() => {
      res.clearCookie('connect.sid')
      res.status(200).json({ loggedOut: true })
    })
  })
})

app.get('/api/catalog', async (_req, res) => {
  const clubDocs = await clubs.find({}).sort({ name: 1 }).toArray()
  const clubIds = clubDocs.map((club) => club.id)

  const [bookDocs, memberDocs] = await Promise.all([
    clubIds.length ? books.find({ clubId: { $in: clubIds } }).toArray() : Promise.resolve([]),
    clubIds.length ? clubMembers.find({ clubId: { $in: clubIds } }).toArray() : Promise.resolve([]),
  ])

  const booksByClubId = new Map()
  const membersByClubId = new Map()

  bookDocs.forEach((book) => {
    const current = booksByClubId.get(book.clubId) ?? []
    current.push({
      id: book.id,
      title: book.title,
      author: book.author,
      content: book.content,
      comments: [],
    })
    booksByClubId.set(book.clubId, current)
  })

  memberDocs.forEach((member) => {
    const current = membersByClubId.get(member.clubId) ?? []
    current.push({
      id: member.id || toMemberId(member.displayName, member.email),
      displayName: member.displayName,
      email: member.email ?? '',
      commentColor: member.commentColor,
    })
    membersByClubId.set(member.clubId, current)
  })

  const payload = clubDocs.map((club) => ({
    id: club.id,
    name: club.name,
    summary: club.summary,
    books: booksByClubId.get(club.id) ?? [],
    members: membersByClubId.get(club.id) ?? [],
  }))

  return res.json(payload)
})

app.post('/api/catalog-sync', async (req, res) => {
  const { clubs: incomingClubs, userProfile, selectedClubId } = req.body ?? {}

  if (!Array.isArray(incomingClubs)) {
    return res.status(400).json({ error: 'clubs must be an array.' })
  }

  const clubOps = []
  const bookOps = []
  const memberOps = []
  const userOps = []
  const memberIdsByClub = new Map()

  incomingClubs.forEach((club) => {
    if (!club?.id || !club?.name || !club?.summary) {
      return
    }

    clubOps.push({
      updateOne: {
        filter: { id: club.id },
        update: {
          $set: {
            id: club.id,
            name: club.name,
            summary: club.summary,
            updatedAt: new Date().toISOString(),
          },
        },
        upsert: true,
      },
    })

    if (Array.isArray(club.books)) {
      club.books.forEach((book) => {
        if (!book?.id || !book?.title || !book?.author || !book?.content) {
          return
        }

        bookOps.push({
          updateOne: {
            filter: { id: book.id },
            update: {
              $set: {
                id: book.id,
                clubId: club.id,
                title: book.title,
                author: book.author,
                content: book.content,
                updatedAt: new Date().toISOString(),
              },
            },
            upsert: true,
          },
        })
      })
    }

    if (Array.isArray(club.members)) {
      const memberIds = new Set()

      club.members.forEach((member) => {
        if (!member?.displayName || !member?.commentColor) {
          return
        }

        const displayName = String(member.displayName).trim()
        const email = typeof member.email === 'string' ? member.email.trim().toLowerCase() : ''
        const id = typeof member.id === 'string' && member.id ? member.id : toMemberId(displayName, email)

        memberIds.add(id)

        memberOps.push({
          updateOne: {
            filter: {
              clubId: club.id,
              id,
            },
            update: {
              $set: {
                id,
                clubId: club.id,
                displayName,
                email,
                commentColor: member.commentColor,
                updatedAt: new Date().toISOString(),
              },
              $setOnInsert: {
                createdAt: new Date().toISOString(),
              },
            },
            upsert: true,
          },
        })

        userOps.push({
          updateOne: {
            filter: email ? { email } : { displayName },
            update: {
              $set: {
                displayName,
                email,
                commentColor: member.commentColor,
                updatedAt: new Date().toISOString(),
              },
              $setOnInsert: {
                createdAt: new Date().toISOString(),
              },
            },
            upsert: true,
          },
        })
      })

      memberIdsByClub.set(club.id, memberIds)
    }
  })

  if (userProfile?.displayName && userProfile?.commentColor) {
    const clubsForMembership =
      typeof selectedClubId === 'string' && selectedClubId
        ? [selectedClubId]
        : incomingClubs.map((club) => club?.id).filter(Boolean)

    clubsForMembership.forEach((clubId) => {
      const id = toMemberId(userProfile.displayName, typeof userProfile.email === 'string' ? userProfile.email : '')

      const currentMemberIds = memberIdsByClub.get(clubId) ?? new Set()
      currentMemberIds.add(id)
      memberIdsByClub.set(clubId, currentMemberIds)

      memberOps.push({
        updateOne: {
          filter: {
            clubId,
            id,
          },
          update: {
            $set: {
              id,
              clubId,
              displayName: userProfile.displayName,
              email: typeof userProfile.email === 'string' ? userProfile.email : '',
              commentColor: userProfile.commentColor,
              updatedAt: new Date().toISOString(),
            },
            $setOnInsert: {
              createdAt: new Date().toISOString(),
            },
          },
          upsert: true,
        },
      })

      userOps.push({
        updateOne: {
          filter:
            typeof userProfile.email === 'string' && userProfile.email
              ? { email: userProfile.email }
              : { displayName: userProfile.displayName },
          update: {
            $set: {
              displayName: userProfile.displayName,
              email: typeof userProfile.email === 'string' ? userProfile.email : '',
              commentColor: userProfile.commentColor,
              updatedAt: new Date().toISOString(),
            },
            $setOnInsert: {
              createdAt: new Date().toISOString(),
            },
          },
          upsert: true,
        },
      })
    })
  }

  if (clubOps.length) {
    await clubs.bulkWrite(clubOps, { ordered: false })
  }

  if (bookOps.length) {
    await books.bulkWrite(bookOps, { ordered: false })
  }

  if (memberOps.length) {
    await clubMembers.bulkWrite(memberOps, { ordered: false })
  }

  if (memberIdsByClub.size) {
    await Promise.all(
      [...memberIdsByClub.entries()].map(([clubId, memberIds]) =>
        clubMembers.deleteMany({
          clubId,
          id: { $nin: [...memberIds] },
        }),
      ),
    )
  }

  if (userOps.length) {
    await users.bulkWrite(userOps, { ordered: false })
  }

  return res.status(200).json({
    synced: true,
    clubs: clubOps.length,
    books: bookOps.length,
    members: memberOps.length,
    users: userOps.length,
  })
})

app.get('/api/comments', async (req, res) => {
  const { bookId } = req.query

  if (!bookId || typeof bookId !== 'string') {
    return res.status(400).json({ error: 'bookId query parameter is required.' })
  }

  const docs = await comments.find({ bookId }).sort({ createdAt: -1 }).toArray()
  return res.json(docs)
})

app.post('/api/comments', async (req, res) => {
  const { id, bookId, author, text, quote, type, parentCommentId = null } = req.body ?? {}

  if (!id || !bookId || !author || !text || !quote || !type) {
    return res.status(400).json({
      error: 'id, bookId, author, text, quote, and type are required.',
    })
  }

  if (type !== 'underline' && type !== 'highlight') {
    return res.status(400).json({ error: "type must be 'underline' or 'highlight'." })
  }

  const doc = {
    id,
    bookId,
    author,
    text,
    quote,
    type,
    parentCommentId,
    createdAt: new Date().toISOString(),
  }

  const result = await comments.insertOne(doc)
  return res.status(201).json({ ...doc, _id: result.insertedId })
})

if (isProduction) {
  app.use(express.static(distPath))
  app.get(/^\/(?!api|auth).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(port, () => console.log(`API running on ${port}`))