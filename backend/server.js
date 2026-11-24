require('dotenv').config()
require('express-async-errors')
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const helmet = require('helmet')
const compression = require('compression')
const rateLimit = require('express-rate-limit')
const connectDB = require('./config/db')
const { errorHandler, notFound } = require('./middleware/errorMiddleware')

// Route imports
const authRoutes = require('./routes/authRoutes')
const userRoutes = require('./routes/userRoutes')
const companyRoutes = require('./routes/companyRoutes')
const discountRoutes = require('./routes/discountRoutes')
const planRoutes = require('./routes/planRoutes')
const subscriptionRoutes = require('./routes/subscriptionRoutes')
const paymentRoutes = require('./routes/paymentRoutes')
const notificationRoutes = require('./routes/notificationRoutes')
const reviewRoutes = require('./routes/reviewRoutes')
const enrollmentRoutes = require('./routes/enrollmentRoutes')
const installmentRoutes = require('./routes/installmentRoutes')
const cardRoutes = require('./routes/cardRoutes')
const featureRoutes = require('./routes/featureRoutes')
const analyticsRoutes = require('./routes/analyticsRoutes')
const medicalCenterRoutes = require('./routes/medicalCenterRoutes')
const bankRoutes = require('./routes/bankRoutes')
const serviceRequestRoutes = require('./routes/serviceRequestRoutes')

connectDB()

const app = express()

// Behind a hosting proxy (Render): trust the first proxy so rate limiting sees the real client IP
app.set('trust proxy', 1)

// Security headers
app.use(helmet())

// Compression (gzip/brotli)
app.use(compression())

// CORS
// CORS_ORIGIN may hold several origins separated by commas
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
app.use(cors({
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  credentials: true,
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
})
app.use('/api/', limiter)

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again later' },
})
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/signup', authLimiter)

// Request logging
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'))
} else {
  app.use(morgan('dev'))
}

// Body parsing with size limits
app.use(express.json({ limit: '100kb' }))
app.use(express.urlencoded({ extended: true, limit: '100kb' }))

// Make sure the database is connected before an API request runs (retries after a failed start-up)
app.use('/api', (req, res, next) => { connectDB().then(() => next(), () => next()) })

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/companies', companyRoutes)
app.use('/api/discounts', discountRoutes)
app.use('/api/plans', planRoutes)
app.use('/api/subscriptions', subscriptionRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/enrollments', enrollmentRoutes)
app.use('/api/installments', installmentRoutes)
app.use('/api/cards', cardRoutes)
app.use('/api/features', featureRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/medical-centers', medicalCenterRoutes)
app.use('/api/banks', bankRoutes)
app.use('/api/service-requests', serviceRequestRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use(notFound)
app.use(errorHandler)

// On Vercel the platform runs the exported app as a serverless function, so we only listen elsewhere
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

module.exports = app
