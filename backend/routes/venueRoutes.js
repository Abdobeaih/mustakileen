const express = require('express')
const router = express.Router()
const Restaurant = require('../models/Restaurant')
const EntertainmentVenue = require('../models/EntertainmentVenue')

// Public lists shown on the service pages. Optional filters: ?governorate=...&category=...
const listOf = (Model, allowed) => async (req, res, next) => {
  try {
    const filter = {}
    allowed.forEach((key) => {
      if (typeof req.query[key] === 'string' && req.query[key] !== 'all') filter[key] = req.query[key]
    })
    const data = await Model.find(filter).sort('legacy_id').lean()
    res.json({ success: true, data })
  } catch (error) { next(error) }
}

router.get('/restaurants', listOf(Restaurant, ['governorate', 'cuisine']))
router.get('/entertainment', listOf(EntertainmentVenue, ['governorate', 'category']))

module.exports = router
