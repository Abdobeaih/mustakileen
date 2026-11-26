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
const Company = require('../models/Company')
const Discount = require('../models/Discount')
const Payment = require('../models/Payment')
const UserScan = require('../models/UserScan')

const app = express()
app.use(express.json())
app.use('/api/analytics', require('../routes/analyticsRoutes'))
app.use(errorHandler)

let mongod, adminT, userT, shifaT, otherT, shifa, disc
const auth = (t) => ({ Authorization: `Bearer ${t}` })

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})
beforeEach(async () => {
  await Promise.all([Admin, User, Company, Discount, Payment, UserScan].map((m) => m.deleteMany({})))
  const admin = await Admin.create({ name: 'A', email: 'a@test.dev', password: 'pass1234', role: 'SUPER_ADMIN' })
  const user = await User.create({ name: 'U', email: 'u@test.dev', phone: '1', nationalId: '1', job: 'x', password: 'pass1234', governorate: 'Cairo' })
  shifa = await Company.create({ name: 'Shifa', email: 's@test.dev', password: 'pass1234', category: 'medical', status: 'approved' })
  const other = await Company.create({ name: 'Other', email: 'o@test.dev', password: 'pass1234', category: 'food' })
  disc = await Discount.create({ company_id: shifa._id, name: '20%', category: 'medical', discount_percent: '20', discount_type: 'PROMO_CODE', promo_code: 'X', start_date: '2026-01-01', end_date: '2026-12-31', status: 'approved', views: 5, uses: 2 })
  await UserScan.create({ user_id: user._id, discount_id: disc._id })
  await Payment.create([{ user_id: user._id, amount: 100, payment_method: 'VISA', status: 'SUCCESS' }, { user_id: user._id, amount: 40, payment_method: 'CASH', status: 'PENDING' }])
  adminT = generateToken(admin._id)
  userT = generateToken(user._id)
  shifaT = generateToken(shifa._id)
  otherT = generateToken(other._id)
})

describe('analytics', () => {
  it('dashboard shows real counts to admin only', async () => {
    const res = await request(app).get('/api/analytics/dashboard').set(auth(adminT))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ totalUsers: 1, totalCompanies: 2, pendingCompanies: 1, totalDiscounts: 1, pendingDiscounts: 0, approvedDiscounts: 1, totalScans: 1, totalRevenue: 100 })
    expect((await request(app).get('/api/analytics/dashboard').set(auth(shifaT))).status).toBe(403)
    expect((await request(app).get('/api/analytics/dashboard')).status).toBe(401)
  })

  it('dashboard works on an empty database', async () => {
    await Promise.all([User, Company, Discount, Payment, UserScan].map((m) => m.deleteMany({})))
    const res = await request(app).get('/api/analytics/dashboard').set(auth(adminT))
    expect(res.body.data.totalRevenue).toBe(0)
    expect(res.body.data.totalUsers).toBe(0)
  })

  it('revenue by month counts only successful payments', async () => {
    const res = await request(app).get('/api/analytics/revenue').set(auth(adminT))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].total).toBe(100)
    expect((await request(app).get('/api/analytics/revenue').set(auth(userT))).status).toBe(403)
  })

  it('company analytics: own company or admin only', async () => {
    const own = await request(app).get(`/api/analytics/company/${shifa._id}`).set(auth(shifaT))
    expect(own.status).toBe(200)
    expect(own.body.data).toMatchObject({ totalDiscounts: 1, totalViews: 5, totalUses: 2, totalScans: 1 })
    expect((await request(app).get(`/api/analytics/company/${shifa._id}`).set(auth(otherT))).status).toBe(403)
    expect((await request(app).get(`/api/analytics/company/${shifa._id}`).set(auth(userT))).status).toBe(403)
    expect((await request(app).get(`/api/analytics/company/${shifa._id}`).set(auth(adminT))).status).toBe(200)
  })

  it('discount usage: admin or owning company only', async () => {
    const url = `/api/analytics/discount/${disc._id}/usage`
    expect((await request(app).get(url).set(auth(shifaT))).body.data).toHaveLength(1)
    expect((await request(app).get(url).set(auth(adminT))).status).toBe(200)
    expect((await request(app).get(url).set(auth(otherT))).status).toBe(403)
    expect((await request(app).get(url).set(auth(userT))).status).toBe(403)
    expect((await request(app).get(`/api/analytics/discount/${new mongoose.Types.ObjectId()}/usage`).set(auth(otherT))).status).toBe(404)
  })
})
