const mongoose = require('mongoose')

const entSchema = new mongoose.Schema({
  legacy_id: String,
  name: String,
  governorate: String,
  address: String,
  phone: String,
  rating: Number,
  img_url: String,
  description: String,
  category: String,
  discount_percent: String,
  city: String,
}, { timestamps: true })

module.exports = mongoose.model('EntertainmentVenue', entSchema)
