process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'

const express = require('express')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')

const companyRoutes = require('../routes/companyRoutes')
const discountRoutes = require('../routes/discountRoutes')
const { errorHandler } = require('../middleware/errorMiddleware')
const generateToken = require('../utils/generateToken')
const Admin = require('../models/Admin')
const User = require('../models/User')
const Company = require('../models/Company')
const Discount = require('../models/Discount')
const UserScan = require('../models/UserScan')

const app = express()
app.use(express.json())
app.use('/api/companies', companyRoutes)
app.use('/api/discounts', discountRoutes)
app.use(errorHandler)

let mongod
let admin, user, shifa, other
let adminT, userT, shifaT, otherT

const auth = (t) => ({ Authorization: `Bearer ${t}` })
const discountBody = { name: '20% off', category: 'medical', discount_percent: '20', discount_type: 'PROMO_CODE', promo_code: 'SAVE20', start_date: '2026-01-01', end_date: '2026-12-31' }

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await Promise.all([Admin.deleteMany({}), User.deleteMany({}), Company.deleteMany({}), Discount.deleteMany({}), UserScan.deleteMany({})])
  admin = await Admin.create({ name: 'Admin', email: 'admin@test.dev', password: 'pass1234', role: 'SUPER_ADMIN' })
  user = await User.create({ name: 'U', email: 'u@test.dev', phone: '01', nationalId: '1', job: 'dev', password: 'pass1234', governorate: 'Cairo' })
  shifa = await Company.create({ name: 'Shifa', email: 'shifa@test.dev', password: 'pass1234', category: 'medical' })
  other = await Company.create({ name: 'Other', email: 'other@test.dev', password: 'pass1234', category: 'food' })
  adminT = generateToken(admin._id)
  userT = generateToken(user._id)
  shifaT = generateToken(shifa._id)
  otherT = generateToken(other._id)
})

describe('companies', () => {
  it('requires a login to list companies', async () => {
    const res = await request(app).get('/api/companies')
    expect(res.status).toBe(401)
  })

  it('lists companies without exposing password hashes', async () => {
    const res = await request(app).get('/api/companies').set(auth(userT))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    res.body.data.forEach((c) => expect(c.password).toBeUndefined())
  })

  it('searches companies by name', async () => {
    const res = await request(app).get('/api/companies?search=shif').set(auth(userT))
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Shifa')
  })

  it('gets one company without the password, and 404 for an unknown id', async () => {
    const ok = await request(app).get(`/api/companies/${shifa._id}`).set(auth(userT))
    expect(ok.status).toBe(200)
    expect(ok.body.data.password).toBeUndefined()
    const missing = await request(app).get(`/api/companies/${new mongoose.Types.ObjectId()}`).set(auth(userT))
    expect(missing.status).toBe(404)
  })

  it('lets only an admin create a company, and hides the password in the reply', async () => {
    const body = { name: 'New', email: 'new@test.dev', password: 'pass1234' }
    expect((await request(app).post('/api/companies').set(auth(userT)).send(body)).status).toBe(403)
    const res = await request(app).post('/api/companies').set(auth(adminT)).send(body)
    expect(res.status).toBe(201)
    expect(res.body.data.password).toBeUndefined()
  })

  it('lets a company edit itself but not another company', async () => {
    const own = await request(app).put(`/api/companies/${shifa._id}`).set(auth(shifaT)).send({ description: 'Updated' })
    expect(own.status).toBe(200)
    expect(own.body.data.description).toBe('Updated')
    const foreign = await request(app).put(`/api/companies/${other._id}`).set(auth(shifaT)).send({ description: 'Hacked' })
    expect(foreign.status).toBe(403)
    const asUser = await request(app).put(`/api/companies/${shifa._id}`).set(auth(userT)).send({ description: 'Hacked' })
    expect(asUser.status).toBe(403)
  })

  it('does not let a company approve itself or change its password through an update', async () => {
    await request(app).put(`/api/companies/${shifa._id}`).set(auth(shifaT)).send({ status: 'approved', password: 'newpass99' })
    const saved = await Company.findById(shifa._id)
    expect(saved.status).toBe('pending')
    expect(await saved.matchPassword('pass1234')).toBe(true)
  })

  it('lets only an admin approve, reject and delete', async () => {
    expect((await request(app).put(`/api/companies/${shifa._id}/approve`).set(auth(shifaT))).status).toBe(403)
    const approved = await request(app).put(`/api/companies/${shifa._id}/approve`).set(auth(adminT))
    expect(approved.status).toBe(200)
    expect(approved.body.data.status).toBe('approved')
    expect(approved.body.data.password).toBeUndefined()
    const rejected = await request(app).put(`/api/companies/${shifa._id}/reject`).set(auth(adminT))
    expect(rejected.body.data.status).toBe('rejected')
    expect((await request(app).delete(`/api/companies/${shifa._id}`).set(auth(shifaT))).status).toBe(403)
    expect((await request(app).delete(`/api/companies/${shifa._id}`).set(auth(adminT))).status).toBe(200)
    expect(await Company.countDocuments()).toBe(1)
  })

  it('gives admin-only stats', async () => {
    await request(app).put(`/api/companies/${shifa._id}/approve`).set(auth(adminT))
    const res = await request(app).get('/api/companies/stats').set(auth(adminT))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ total: 2, pending: 1, approved: 1 })
    expect((await request(app).get('/api/companies/stats').set(auth(userT))).status).toBe(403)
  })

  it('lets a company add branches, and others read them', async () => {
    const add = await request(app).post(`/api/companies/${shifa._id}/branches`).set(auth(shifaT)).send({ name: 'Main', address: 'Nile st', city: 'Cairo' })
    expect(add.status).toBe(201)
    const list = await request(app).get(`/api/companies/${shifa._id}/branches`).set(auth(userT))
    expect(list.body.data).toHaveLength(1)
    expect((await request(app).post(`/api/companies/${shifa._id}/branches`).set(auth(userT)).send({ name: 'x' })).status).toBe(403)
  })
})

describe('discounts', () => {
  it('lets a company create a discount that starts pending and belongs to it', async () => {
    const res = await request(app).post('/api/discounts').set(auth(shifaT)).send({ ...discountBody, company_id: String(other._id) })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('pending')
    expect(String(res.body.data.company_id)).toBe(String(shifa._id))
  })

  it('blocks users and admins from creating discounts, and rejects bad data', async () => {
    expect((await request(app).post('/api/discounts').set(auth(userT)).send(discountBody)).status).toBe(403)
    expect((await request(app).post('/api/discounts').set(auth(adminT)).send(discountBody)).status).toBe(403)
    const bad = await request(app).post('/api/discounts').set(auth(shifaT)).send({ name: 'no fields' })
    expect(bad.status).toBe(400)
  })

  it('lists, filters and reads discounts', async () => {
    await Discount.create([{ ...discountBody, company_id: shifa._id }, { ...discountBody, name: 'Pizza', category: 'food', company_id: other._id }])
    const all = await request(app).get('/api/discounts').set(auth(userT))
    expect(all.body.data).toHaveLength(2)
    const food = await request(app).get('/api/discounts?category=food').set(auth(userT))
    expect(food.body.data).toHaveLength(1)
    expect(food.body.data[0].name).toBe('Pizza')
    const one = await request(app).get(`/api/discounts/${all.body.data[0]._id}`).set(auth(userT))
    expect(one.status).toBe(200)
    expect((await request(app).get(`/api/discounts/${new mongoose.Types.ObjectId()}`).set(auth(userT))).status).toBe(404)
  })

  it('lets only the owner company or an admin edit and delete a discount', async () => {
    const d = await Discount.create({ ...discountBody, company_id: shifa._id })
    expect((await request(app).put(`/api/discounts/${d._id}`).set(auth(otherT)).send({ name: 'Hacked' })).status).toBe(403)
    expect((await request(app).put(`/api/discounts/${d._id}`).set(auth(userT)).send({ name: 'Hacked' })).status).toBe(403)
    const own = await request(app).put(`/api/discounts/${d._id}`).set(auth(shifaT)).send({ name: 'Renamed', uses: 999, status: 'approved' })
    expect(own.status).toBe(200)
    expect(own.body.data.name).toBe('Renamed')
    expect(own.body.data.uses).toBe(0)
    expect(own.body.data.status).toBe('pending')
    expect((await request(app).delete(`/api/discounts/${d._id}`).set(auth(otherT))).status).toBe(403)
    expect((await request(app).delete(`/api/discounts/${d._id}`).set(auth(adminT))).status).toBe(200)
    expect(await Discount.countDocuments()).toBe(0)
  })

  it('lets only an admin approve or reject', async () => {
    const d = await Discount.create({ ...discountBody, company_id: shifa._id })
    expect((await request(app).put(`/api/discounts/${d._id}/approve`).set(auth(shifaT))).status).toBe(403)
    const ok = await request(app).put(`/api/discounts/${d._id}/approve`).set(auth(adminT))
    expect(ok.body.data.status).toBe('approved')
    const no = await request(app).put(`/api/discounts/${d._id}/reject`).set(auth(adminT))
    expect(no.body.data.status).toBe('rejected')
  })

  it('records a scan, counts the use, and shows scans to admins only', async () => {
    const d = await Discount.create({ ...discountBody, company_id: shifa._id })
    const scan = await request(app).post(`/api/discounts/${d._id}/scan`).set(auth(userT)).send({})
    expect(scan.status).toBe(201)
    expect((await Discount.findById(d._id)).uses).toBe(1)
    const scans = await request(app).get(`/api/discounts/${d._id}/scans`).set(auth(adminT))
    expect(scans.body.data).toHaveLength(1)
    expect((await request(app).get(`/api/discounts/${d._id}/scans`).set(auth(userT))).status).toBe(403)
  })

  it('counts views', async () => {
    const d = await Discount.create({ ...discountBody, company_id: shifa._id })
    await request(app).post(`/api/discounts/${d._id}/views`).set(auth(userT))
    const res = await request(app).post(`/api/discounts/${d._id}/views`).set(auth(userT))
    expect(res.body.data.views).toBe(2)
  })
})
