process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'

jest.mock('../utils/sendEmail', () => ({
  sendForgotPasswordOtp: jest.fn().mockResolvedValue(),
  sendSignupOtp: jest.fn().mockResolvedValue(),
  sendPasswordResetConfirmation: jest.fn().mockResolvedValue(),
  sendWelcomeEmail: jest.fn().mockResolvedValue(),
}))

const express = require('express')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')

const authRoutes = require('../routes/authRoutes')
const { errorHandler } = require('../middleware/errorMiddleware')
const { adminOnly, companyOnly } = require('../middleware/authMiddleware')
const { sendSignupOtp } = require('../utils/sendEmail')
const User = require('../models/User')
const Otp = require('../models/Otp')

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
  await Promise.all([User.deleteMany({}), Otp.deleteMany({})])
  jest.clearAllMocks()
})

const validBody = {
  name: '  Test User ',
  email: 'New.User@Test.dev',
  phone: '01000000000',
  nationalId: '29900000000000',
  job: 'Engineer',
  password: 'pass1234',
  governorate: 'Cairo',
}

describe('POST /api/auth/register', () => {
  it('creates a user, hashes the password and returns a token', async () => {
    const res = await request(app).post('/api/auth/register').send(validBody)
    expect(res.status).toBe(201)
    expect(res.body.data.token).toBeTruthy()
    expect(res.body.data.user.email).toBe('new.user@test.dev')
    expect(res.body.data.user.name).toBe('Test User')
    expect(res.body.data.user.password).toBeUndefined()

    const saved = await User.findOne({ email: 'new.user@test.dev' })
    expect(saved.password).not.toBe('pass1234')
    expect(await saved.matchPassword('pass1234')).toBe(true)
  })

  it('sends a verification code and stores it hashed', async () => {
    await request(app).post('/api/auth/register').send(validBody)
    expect(sendSignupOtp).toHaveBeenCalledTimes(1)
    const sentCode = sendSignupOtp.mock.calls[0][2]
    expect(sentCode).toMatch(/^\d{6}$/)
    const otp = await Otp.findOne({ email: 'new.user@test.dev' })
    expect(otp).toBeTruthy()
    expect(otp.code).not.toBe(sentCode)
  })

  it('rejects a request with missing fields', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'x@test.dev', password: 'pass1234' })
    expect(res.status).toBe(400)
    expect(await User.countDocuments()).toBe(0)
  })

  it('rejects a duplicate email', async () => {
    await request(app).post('/api/auth/register').send(validBody)
    const res = await request(app).post('/api/auth/register').send(validBody)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/already exists/i)
    expect(await User.countDocuments()).toBe(1)
  })

  it('falls back to the free plan for an unknown plan name', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...validBody, plan: 'platinum' })
    expect(res.status).toBe(201)
    expect(res.body.data.user.plan).toBe('free')
  })

  it('can log in right after registering', async () => {
    await request(app).post('/api/auth/register').send(validBody)
    const res = await request(app).post('/api/auth/login').send({ email: 'new.user@test.dev', password: 'pass1234' })
    expect(res.status).toBe(200)
    expect(res.body.data.role).toBe('user')
  })
})

describe('role guards', () => {
  const run = (guard, entityType) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this } }
    const next = jest.fn()
    guard({ entityType }, res, next)
    return { res, next }
  }

  it('adminOnly lets admins through and blocks others with 403', () => {
    expect(run(adminOnly, 'admin').next).toHaveBeenCalledWith()
    const blocked = run(adminOnly, 'user')
    expect(blocked.res.statusCode).toBe(403)
    expect(blocked.next.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('companyOnly lets companies through and blocks others with 403', () => {
    expect(run(companyOnly, 'company').next).toHaveBeenCalledWith()
    expect(run(companyOnly, 'admin').res.statusCode).toBe(403)
  })
})
