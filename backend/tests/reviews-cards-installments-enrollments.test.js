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
const Card = require('../models/Card')
const Installment = require('../models/Installment')
const Review = require('../models/Review')
const Enrollment = require('../models/Enrollment')

const app = express()
app.use(express.json())
app.use('/api/reviews', require('../routes/reviewRoutes'))
app.use('/api/cards', require('../routes/cardRoutes'))
app.use('/api/installments', require('../routes/installmentRoutes'))
app.use('/api/enrollments', require('../routes/enrollmentRoutes'))
app.use(errorHandler)

let mongod, u1, u2, adminT, t1, t2
const auth = (t) => ({ Authorization: `Bearer ${t}` })
const mkUser = (n) => User.create({ name: n, email: `${n}@test.dev`, phone: '01', nationalId: '1', job: 'dev', password: 'pass1234', governorate: 'Cairo' })
const card = { card_holder_name: 'A B', card_number: '4111111111111111', expiry: '12/30' }

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})
afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})
beforeEach(async () => {
  await Promise.all([Admin, User, Card, Installment, Review, Enrollment].map((m) => m.deleteMany({})))
  const admin = await Admin.create({ name: 'A', email: 'a@test.dev', password: 'pass1234', role: 'SUPER_ADMIN' })
  u1 = await mkUser('one')
  u2 = await mkUser('two')
  adminT = generateToken(admin._id)
  t1 = generateToken(u1._id)
  t2 = generateToken(u2._id)
})

describe('reviews', () => {
  const body = () => ({ discount_id: new mongoose.Types.ObjectId(), rating: 4, comment: 'good' })

  it('creates a review for the caller and validates rating', async () => {
    const ok = await request(app).post('/api/reviews').set(auth(t1)).send(body())
    expect(ok.status).toBe(201)
    expect(ok.body.stats.count).toBe(1)
    expect((await request(app).post('/api/reviews').set(auth(t1)).send({ ...body(), rating: 9 })).status).toBeGreaterThanOrEqual(400)
    expect((await request(app).post('/api/reviews').send(body())).status).toBe(401)
  })

  it('only the author or admin can delete; list-all is admin only', async () => {
    const r = (await request(app).post('/api/reviews').set(auth(t1)).send(body())).body.data
    expect((await request(app).delete(`/api/reviews/${r._id}`).set(auth(t2))).status).toBe(403)
    expect(await Review.countDocuments()).toBe(1)
    expect((await request(app).get('/api/reviews/all').set(auth(t2))).status).toBe(403)
    expect((await request(app).get('/api/reviews/all').set(auth(adminT))).body.data).toHaveLength(1)
    expect((await request(app).delete(`/api/reviews/${r._id}`).set(auth(t1))).status).toBe(200)
    expect((await request(app).delete(`/api/reviews/${r._id}`).set(auth(t1))).status).toBe(404)
  })

  it('social reviews: create, list by target, owner-only delete', async () => {
    const target = new mongoose.Types.ObjectId()
    const c = await request(app).post('/api/reviews/social').set(auth(t1)).send({ target_type: 'medical_center', target_id: String(target), rating: 5, comment: 'ok' })
    expect(c.status).toBe(201)
    {
      const list = await request(app).get('/api/reviews/social').set(auth(t2)).query({ target_type: 'medical_center', target_id: String(target) })
      expect(list.body.data).toHaveLength(1)
      expect((await request(app).delete(`/api/reviews/social/${c.body.data._id}`).set(auth(t2))).status).toBe(403)
      expect((await request(app).delete(`/api/reviews/social/${c.body.data._id}`).set(auth(t1))).status).toBe(200)
    }
  })
})

describe('cards', () => {
  it('never returns the full card number', async () => {
    const c = await request(app).post('/api/cards').set(auth(t1)).send(card)
    expect(c.status).toBe(201)
    expect(JSON.stringify(c.body)).not.toContain('4111111111111111')
    expect(c.body.data.card_number.endsWith('1111')).toBe(true)
    const list = await request(app).get('/api/cards').set(auth(t1))
    expect(JSON.stringify(list.body)).not.toContain('4111111111111111')
    expect((await request(app).get('/api/cards').set(auth(t2))).body.data).toHaveLength(0)
  })

  it('only the owner can delete or set default', async () => {
    const id = (await request(app).post('/api/cards').set(auth(t1)).send(card)).body.data._id
    expect((await request(app).delete(`/api/cards/${id}`).set(auth(t2))).status).toBe(404)
    expect((await request(app).put(`/api/cards/${id}/default`).set(auth(t2))).status).toBe(404)
    expect(await Card.countDocuments()).toBe(1)
    expect((await request(app).put(`/api/cards/${id}/default`).set(auth(t1))).body.data.is_default).toBe(true)
    expect((await request(app).delete(`/api/cards/${id}`).set(auth(t1))).status).toBe(200)
  })

  it('keeps one default card', async () => {
    await request(app).post('/api/cards').set(auth(t1)).send({ ...card, is_default: true })
    await request(app).post('/api/cards').set(auth(t1)).send({ ...card, is_default: true })
    expect(await Card.countDocuments({ user_id: u1._id, is_default: true })).toBe(1)
  })
})

describe('installments', () => {
  const body = { name: 'Phone', total: 1000, monthly_amount: 250 }

  it('creates without letting the client set paid or status', async () => {
    const res = await request(app).post('/api/installments').set(auth(t1)).send({ ...body, paid: 1000, status: 'completed' })
    expect(res.status).toBe(201)
    expect(res.body.data.paid).toBe(0)
    expect(res.body.data.status).toBe('active')
  })

  it('pays by the monthly amount, completes at the total, rejects bad amounts', async () => {
    const id = (await request(app).post('/api/installments').set(auth(t1)).send(body)).body.data._id
    expect((await request(app).put(`/api/installments/${id}/pay`).set(auth(t1)).send({})).body.data.paid).toBe(250)
    expect((await request(app).put(`/api/installments/${id}/pay`).set(auth(t1)).send({ amount: -5 })).status).toBe(400)
    const done = await request(app).put(`/api/installments/${id}/pay`).set(auth(t1)).send({ amount: 750 })
    expect(done.body.data.status).toBe('completed')
  })

  it('others cannot pay it; admin lists all, user lists own', async () => {
    const id = (await request(app).post('/api/installments').set(auth(t1)).send(body)).body.data._id
    expect((await request(app).put(`/api/installments/${id}/pay`).set(auth(t2))).status).toBe(404)
    expect((await request(app).get('/api/installments').set(auth(t1))).status).toBe(403)
    expect((await request(app).get('/api/installments').set(auth(adminT))).body.data).toHaveLength(1)
    expect((await request(app).get('/api/installments/my').set(auth(t2))).body.data).toHaveLength(0)
  })
})

describe('enrollments', () => {
  it('enrolls, validates service type, and lists own', async () => {
    expect((await request(app).post('/api/enrollments').set(auth(t1)).send({})).status).toBe(400)
    expect((await request(app).post('/api/enrollments').set(auth(t1)).send({ service_type: 'bad' })).status).toBe(400)
    expect((await request(app).post('/api/enrollments').set(auth(t1)).send({ service_type: 'medical' })).status).toBe(201)
    expect((await request(app).get('/api/enrollments/my').set(auth(t1))).body.data).toHaveLength(1)
    expect((await request(app).get('/api/enrollments/my').set(auth(t2))).body.data).toHaveLength(0)
    expect((await request(app).get('/api/enrollments').set(auth(t1))).status).toBe(403)
    expect((await request(app).get('/api/enrollments').set(auth(adminT))).body.data).toHaveLength(1)
  })

  it('only the owner can confirm an enrollment', async () => {
    const id = (await request(app).post('/api/enrollments').set(auth(t1)).send({ service_type: 'financial' })).body.data._id
    expect((await request(app).post('/api/enrollments/confirm').set(auth(t2)).send({ enrollment_id: id })).status).toBe(403)
    const ok = await request(app).post('/api/enrollments/confirm').set(auth(t1)).send({ enrollment_id: id, name: 'X', agreeTerms: true })
    expect(ok.status).toBe(200)
    expect(ok.body.data.subscription_confirmed).toBe(true)
    expect((await request(app).post('/api/enrollments/confirm').set(auth(t1)).send({})).status).toBe(400)
  })
})
