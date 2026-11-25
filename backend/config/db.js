const mongoose = require('mongoose')
const Admin = require('../models/Admin')
const Restaurant = require('../models/Restaurant')
const EntertainmentVenue = require('../models/EntertainmentVenue')
const referenceData = require('../seeds/referenceData.json')

// Connection: MONGODB_URI as before, or the host/user/password parts set separately
// (MONGODB_HOST, MONGODB_USER, MONGODB_PASSWORD, optional MONGODB_DB).
const getConnection = () => {
  if (process.env.MONGODB_URI) return { uri: process.env.MONGODB_URI, options: {} }
  const { MONGODB_HOST, MONGODB_USER, MONGODB_PASSWORD, MONGODB_DB } = process.env
  if (MONGODB_HOST && MONGODB_USER && MONGODB_PASSWORD) {
    return {
      uri: `mongodb+srv://${MONGODB_HOST}/${MONGODB_DB || 'mustakilen'}?retryWrites=true&w=majority`,
      options: { user: MONGODB_USER, pass: MONGODB_PASSWORD },
    }
  }
  return { uri: undefined, options: {} }
}

// Create the first admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD when it does not exist yet.
// Never overwrites an existing admin and never logs the credentials.
const ensureAdmin = async () => {
  const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!email || !password) return
  const existing = await Admin.findOne({ email })
  if (existing) return
  await Admin.create({ name: 'Admin', email, password, role: 'SUPER_ADMIN' })
  console.log('Admin account created from environment settings')
}

// Fill the public lists (restaurants, entertainment venues) the first time, when they are empty.
// Never touches a list that already has data.
const ensureReferenceData = async () => {
  if ((await Restaurant.countDocuments()) === 0) await Restaurant.insertMany(referenceData.restaurants)
  if ((await EntertainmentVenue.countDocuments()) === 0) await EntertainmentVenue.insertMany(referenceData.entertainmentVenues)
}

// Connect once, and retry on the next call when it failed. On a serverless host a single
// failed attempt at start-up must not leave the instance without a database for good.
let pending = null
const connectDB = () => {
  if (mongoose.connection.readyState === 1) return Promise.resolve()
  if (!pending) {
    pending = (async () => {
      try {
        const { uri, options } = getConnection()
        const conn = await mongoose.connect(uri, { ...options, serverSelectionTimeoutMS: 8000 })
        console.log(`MongoDB connected: ${conn.connection.host}`)
        await ensureAdmin()
        await ensureReferenceData()
      } catch (error) {
        console.error(`MongoDB connection error: ${error.message}`)
        console.warn('Server will continue without database — db.js localStorage fallback will be used.')
        pending = null
      }
    })()
  }
  return pending
}

module.exports = connectDB
module.exports.ensureReferenceData = ensureReferenceData
