process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'

const express = require('express')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')

const venueRoutes = require('../routes/venueRoutes')
const { ensureReferenceData } = require('../config/db')
const Restaurant = require('../models/Restaurant')
const EntertainmentVenue = require('../models/EntertainmentVenue')
const referenceData = require('../seeds/referenceData.json')
const { errorHandler } = require('../middleware/errorMiddleware')

const app = express()
app.use('/api', venueRoutes)
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
  await Promise.all([Restaurant.deleteMany({}), EntertainmentVenue.deleteMany({})])
})

describe('reference data seed', () => {
  it('fills empty lists from the seed file', async () => {
    await ensureReferenceData()
    expect(await Restaurant.countDocuments()).toBe(referenceData.restaurants.length)
    expect(await EntertainmentVenue.countDocuments()).toBe(referenceData.entertainmentVenues.length)
  })

  it('does not add or change anything when the lists already have data', async () => {
    await Restaurant.create({ name: 'Only one' })
    await ensureReferenceData()
    expect(await Restaurant.countDocuments()).toBe(1)
    expect(await EntertainmentVenue.countDocuments()).toBe(referenceData.entertainmentVenues.length)
  })

  it('is safe to run twice', async () => {
    await ensureReferenceData()
    await ensureReferenceData()
    expect(await Restaurant.countDocuments()).toBe(referenceData.restaurants.length)
  })
})

describe('GET /api/restaurants and /api/entertainment', () => {
  beforeEach(ensureReferenceData)

  it('are public and return the lists', async () => {
    const r = await request(app).get('/api/restaurants')
    expect(r.status).toBe(200)
    expect(r.body.data).toHaveLength(referenceData.restaurants.length)
    expect(r.body.data[0].name).toBeTruthy()
    const e = await request(app).get('/api/entertainment')
    expect(e.body.data).toHaveLength(referenceData.entertainmentVenues.length)
  })

  it('filters by governorate and category', async () => {
    const gov = referenceData.restaurants[0].governorate
    const expected = referenceData.restaurants.filter((x) => x.governorate === gov).length
    const r = await request(app).get('/api/restaurants').query({ governorate: gov })
    expect(r.body.data).toHaveLength(expected)
    r.body.data.forEach((x) => expect(x.governorate).toBe(gov))
    const gyms = await request(app).get('/api/entertainment').query({ category: 'gym' })
    expect(gyms.body.data.length).toBeGreaterThan(0)
    gyms.body.data.forEach((x) => expect(x.category).toBe('gym'))
  })

  it('treats governorate=all as no filter and ignores object-style query tricks', async () => {
    const all = await request(app).get('/api/restaurants').query({ governorate: 'all' })
    expect(all.body.data).toHaveLength(referenceData.restaurants.length)
    const trick = await request(app).get('/api/restaurants?governorate[$ne]=x')
    expect(trick.status).toBe(200)
    expect(trick.body.data).toHaveLength(referenceData.restaurants.length)
  })
})
