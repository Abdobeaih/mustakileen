process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'

const express = require('express')
const request = require('supertest')
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const { MongoMemoryServer } = require('mongodb-memory-server')

const authRoutes = require('../routes/authRoutes')
const { errorHandler } = require('../middleware/errorMiddleware')
const Admin = require('../models/Admin')
const User = require('../models/User')
const Company = require('../models/Company')

const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use(errorHandler)

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await Promise.all([Admin.deleteMany({}), User.deleteMany({}), Company.deleteMany({})])
})

describe('Admin model', () => {
  it('stores the password as a bcrypt hash, not plain text', async () => {
    const admin = await Admin.create({ name: 'Admin', email: 'a@test.dev', password: 'Secret#123' })
    expect(admin.password).not.toBe('Secret#123')
    expect(admin.password).toMatch(/^\$2[aby]\$/)
    expect(await admin.matchPassword('Secret#123')).toBe(true)
    expect(await admin.matchPassword('wrong')).toBe(false)
  })

  it('lowercases the email', async () => {
    const admin = await Admin.create({ name: 'Admin', email: 'MixedCase@Test.dev', password: 'x12345' })
    expect(admin.email).toBe('mixedcase@test.dev')
  })
})

describe('POST /api/auth/login (admin)', () => {
  beforeEach(async () => {
    await Admin.create({ name: 'Admin', email: 'admin@test.dev', password: 'Secret#123', role: 'SUPER_ADMIN' })
  })

  it('logs in with the right password and returns a token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'Secret#123' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.role).toBe('admin')
    expect(res.body.data.user.password).toBeUndefined()
    const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET)
    expect(decoded.id).toBeDefined()
  })

  it('rejects a wrong password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'nope' })
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('rejects an unknown email with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.dev', password: 'Secret#123' })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/login (user and company)', () => {
  it('logs in a user and a company', async () => {
    await User.create({ name: 'U', email: 'u@test.dev', phone: '01', nationalId: '1', job: 'dev', password: 'pass1234', governorate: 'Cairo' })
    await Company.create({ name: 'C', email: 'c@test.dev', password: 'pass1234' })
    const u = await request(app).post('/api/auth/login').send({ email: 'u@test.dev', password: 'pass1234' })
    expect(u.status).toBe(200)
    expect(u.body.data.role).toBe('user')
    const c = await request(app).post('/api/auth/login').send({ email: 'c@test.dev', password: 'pass1234' })
    expect(c.status).toBe(200)
    expect(c.body.data.role).toBe('company')
  })
})

describe('GET /api/auth/me', () => {
  it('returns the logged-in admin without the password', async () => {
    await Admin.create({ name: 'Admin', email: 'admin@test.dev', password: 'Secret#123' })
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'Secret#123' })
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.data.token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.email).toBe('admin@test.dev')
    expect(res.body.data.password).toBeUndefined()
  })

  it('rejects a request without a token', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('rejects a token signed with another secret', async () => {
    const bad = jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, 'other-secret')
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bad}`)
    expect(res.status).toBe(401)
  })
})
