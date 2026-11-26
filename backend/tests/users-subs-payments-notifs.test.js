process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'

const express = require('express')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')

const { errorHandler } = require('../middleware/errorMiddleware')
const generateToken = require('../utils/generateToken')
const Admin = require('../models/Admin')
const User = require('../models/User')
const SubscriptionPlan = require('../models/SubscriptionPlan')
const UserSubscription = require('../models/UserSubscription')
const Payment = require('../models/Payment')
const Notification = require('../models/Notification')

const app = express()
app.use(express.json())
app.use('/api/users', require('../routes/userRoutes'))
app.use('/api/subscriptions', require('../routes/subscriptionRoutes'))
app.use('/api/payments', require('../routes/paymentRoutes'))
app.use('/api/notifications', require('../routes/notificationRoutes'))
app.use(errorHandler)

let mongod, admin, u1, u2, adminT, t1, t2, plan
const auth = (t) => ({ Authorization: `Bearer ${t}` })
const mkUser = (n) => User.create({ name: n, email: `${n}@test.dev`, phone: '01', nationalId: '1', job: 'dev', password: 'pass1234', governorate: 'Cairo' })

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})
beforeEach(async () => {
  await Promise.all([Admin, User, SubscriptionPlan, UserSubscription, Payment, Notification].map((m) => m.deleteMany({})))
  admin = await Admin.create({ name: 'Admin', email: 'admin@test.dev', password: 'pass1234', role: 'SUPER_ADMIN' })
  u1 = await mkUser('one')
  u2 = await mkUser('two')
  plan = await SubscriptionPlan.create({ name: 'Premium', price: 100, durationDays: 30 })
  adminT = generateToken(admin._id)
  t1 = generateToken(u1._id)
  t2 = generateToken(u2._id)
})

describe('users', () => {
  it('lists users for admin without password hashes, and blocks normal users', async () => {
    const ok = await request(app).get('/api/users').set(auth(adminT))
    expect(ok.status).toBe(200)
    expect(ok.body.data).toHaveLength(2)
    expect(JSON.stringify(ok.body)).not.toContain('password')
    expect((await request(app).get('/api/users').set(auth(t1))).status).toBe(403)
  })

  it('lets a user read only their own profile', async () => {
    expect((await request(app).get(`/api/users/${u1._id}`).set(auth(t1))).status).toBe(200)
    expect((await request(app).get(`/api/users/${u2._id}`).set(auth(t1))).status).toBe(403)
    expect((await request(app).get(`/api/users/${u2._id}`).set(auth(adminT))).status).toBe(200)
  })

  it('does not return the password when admin creates a user', async () => {
    const res = await request(app).post('/api/users').set(auth(adminT)).send({ name: 'N', email: 'n@test.dev', phone: '1', nationalId: '2', job: 'x', password: 'secret123', governorate: 'Giza' })
    expect(res.status).toBe(201)
    expect(res.body.data.password).toBeUndefined()
  })

  it('stops users editing others or upgrading themselves', async () => {
    expect((await request(app).put(`/api/users/${u2._id}`).set(auth(t1)).send({ name: 'Hacked' })).status).toBe(403)
    const res = await request(app).put(`/api/users/${u1._id}`).set(auth(t1)).send({ name: 'New', role: 'SUPER_ADMIN', plan: 'elite', password: 'x', points: 9999 })
    expect(res.status).toBe(200)
    const fresh = await User.findById(u1._id)
    expect(fresh.name).toBe('New')
    expect(fresh.role).toBe('USER')
    expect(fresh.plan).toBe('free')
    expect(fresh.points).toBe(0)
    expect(await fresh.matchPassword('pass1234')).toBe(true)
  })

  it('lets admin change plan but never writes a raw password', async () => {
    const res = await request(app).put(`/api/users/${u1._id}`).set(auth(adminT)).send({ plan: 'premium', password: 'raw' })
    expect(res.status).toBe(200)
    const fresh = await User.findById(u1._id)
    expect(fresh.plan).toBe('premium')
    expect(await fresh.matchPassword('pass1234')).toBe(true)
  })

  it('only admin can delete and view stats', async () => {
    expect((await request(app).delete(`/api/users/${u2._id}`).set(auth(t1))).status).toBe(403)
    expect((await request(app).get('/api/users/stats').set(auth(adminT))).body.data.total).toBe(2)
    expect((await request(app).delete(`/api/users/${u2._id}`).set(auth(adminT))).status).toBe(200)
  })
})

describe('subscriptions', () => {
  it('subscribes, rejects a second active one, and shows it as current', async () => {
    const a = await request(app).post('/api/subscriptions').set(auth(t1)).send({ planId: plan._id, paymentMethod: 'VISA' })
    expect(a.status).toBe(201)
    expect(a.body.data.price).toBe(100)
    expect((await request(app).post('/api/subscriptions').set(auth(t1)).send({ planId: plan._id })).status).toBe(400)
    const my = await request(app).get('/api/subscriptions/my').set(auth(t1))
    expect(my.body.data.status).toBe('ACTIVE')
    expect((await request(app).get('/api/subscriptions/my').set(auth(t2))).body.data).toBeNull()
  })

  it('returns 404 for an unknown plan', async () => {
    const res = await request(app).post('/api/subscriptions').set(auth(t1)).send({ planId: new mongoose.Types.ObjectId() })
    expect(res.status).toBe(404)
  })

  it('only the owner or admin can cancel', async () => {
    const a = await request(app).post('/api/subscriptions').set(auth(t1)).send({ planId: plan._id })
    const id = a.body.data._id
    expect((await request(app).put(`/api/subscriptions/${id}/cancel`).set(auth(t2))).status).toBe(403)
    expect((await UserSubscription.findById(id)).status).toBe('ACTIVE')
    expect((await request(app).put(`/api/subscriptions/${id}/cancel`).set(auth(t1))).body.data.status).toBe('CANCELLED')
  })

  it('lists all subscriptions for admin only', async () => {
    await request(app).post('/api/subscriptions').set(auth(t1)).send({ planId: plan._id })
    expect((await request(app).get('/api/subscriptions/all').set(auth(t1))).status).toBe(403)
    expect((await request(app).get('/api/subscriptions/all').set(auth(adminT))).body.data).toHaveLength(1)
  })
})

describe('payments', () => {
  const body = { amount: 100, payment_method: 'VISA' }

  it('creates a payment for the caller and cannot self-mark it successful', async () => {
    const res = await request(app).post('/api/payments').set(auth(t1)).send({ ...body, status: 'SUCCESS', user_id: u2._id })
    expect(res.status).toBe(201)
    expect(String(res.body.data.user_id)).toBe(String(u1._id))
    expect(res.body.data.status).toBe('PENDING')
  })

  it('shows users only their own payments', async () => {
    const p = (await request(app).post('/api/payments').set(auth(t1)).send(body)).body.data
    expect((await request(app).get('/api/payments/my').set(auth(t1))).body.data).toHaveLength(1)
    expect((await request(app).get('/api/payments/my').set(auth(t2))).body.data).toHaveLength(0)
    expect((await request(app).get(`/api/payments/${p._id}`).set(auth(t2))).status).toBe(403)
    expect((await request(app).get(`/api/payments/${p._id}`).set(auth(t1))).status).toBe(200)
    expect((await request(app).get(`/api/payments/${p._id}`).set(auth(adminT))).status).toBe(200)
  })

  it('admin-only list and stats', async () => {
    await Payment.create({ user_id: u1._id, amount: 50, payment_method: 'CASH' })
    expect((await request(app).get('/api/payments').set(auth(t1))).status).toBe(403)
    expect((await request(app).get('/api/payments').set(auth(adminT))).body.data).toHaveLength(1)
    expect((await request(app).get('/api/payments/stats').set(auth(adminT))).body.data.totalRevenue).toBe(50)
  })

  it('rejects an invalid payment method', async () => {
    expect((await request(app).post('/api/payments').set(auth(t1)).send({ amount: 5, payment_method: 'BITCOIN' })).status).toBeGreaterThanOrEqual(400)
  })
})

describe('notifications', () => {
  it('requires login', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401)
    expect((await request(app).get('/api/notifications/unread-count')).status).toBe(401)
  })

  it('creates for self, lists, counts and marks read', async () => {
    const c = await request(app).post('/api/notifications').set(auth(t1)).send({ title: 'Hi', user_id: String(u2._id) })
    expect(c.status).toBe(201)
    expect(c.body.data.user_id).toBe(String(u1._id))
    expect((await request(app).get('/api/notifications').set(auth(t1))).body.data).toHaveLength(1)
    expect((await request(app).get('/api/notifications').set(auth(t2))).body.data).toHaveLength(0)
    expect((await request(app).get('/api/notifications').set(auth(t2)).query({ user_id: String(u1._id) })).body.data).toHaveLength(0)
    expect((await request(app).get('/api/notifications/unread-count').set(auth(t1))).body.data.count).toBe(1)
    expect((await request(app).put(`/api/notifications/${c.body.data._id}/read`).set(auth(t1))).body.data.is_read).toBe(true)
    expect((await request(app).get('/api/notifications/unread-count').set(auth(t1))).body.data.count).toBe(0)
  })

  it('admin can notify a user; others cannot touch it', async () => {
    const c = await request(app).post('/api/notifications').set(auth(adminT)).send({ title: 'Welcome', user_id: String(u2._id) })
    expect(c.body.data.user_id).toBe(String(u2._id))
    const id = c.body.data._id
    expect((await request(app).put(`/api/notifications/${id}/read`).set(auth(t1))).status).toBe(404)
    expect((await request(app).delete(`/api/notifications/${id}`).set(auth(t1))).status).toBe(404)
    expect((await request(app).delete(`/api/notifications/${id}`).set(auth(t2))).status).toBe(200)
  })

  it('marks all as read for the caller only', async () => {
    await Notification.create([{ user_id: String(u1._id), title: 'a' }, { user_id: String(u2._id), title: 'b' }])
    await request(app).put('/api/notifications/read-all').set(auth(t1))
    expect((await request(app).get('/api/notifications/unread-count').set(auth(t1))).body.data.count).toBe(0)
    expect((await request(app).get('/api/notifications/unread-count').set(auth(t2))).body.data.count).toBe(1)
  })
})
