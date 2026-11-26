const User = require('../models/User')
const Company = require('../models/Company')
const Discount = require('../models/Discount')
const Payment = require('../models/Payment')
const UserScan = require('../models/UserScan')
const Enrollment = require('../models/Enrollment')

const getDashboardStats = async (req, res, next) => {
  try {
    const [totalUsers, totalCompanies, pendingCompanies, totalDiscounts, pendingDiscounts, approvedDiscounts, totalScans, revenue] = await Promise.all([
      User.countDocuments(),
      Company.countDocuments(),
      Company.countDocuments({ status: 'pending' }),
      Discount.countDocuments(),
      Discount.countDocuments({ status: 'pending' }),
      Discount.countDocuments({ status: 'approved' }),
      UserScan.countDocuments(),
      Payment.aggregate([{ $match: { status: 'SUCCESS' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ])
    const data = { totalUsers, totalCompanies, pendingCompanies, totalDiscounts, pendingDiscounts, approvedDiscounts, totalScans, totalRevenue: revenue[0]?.total || 0 }
    res.json({ success: true, data })
  } catch (error) { next(error) }
}

const getRevenueDetails = async (req, res, next) => {
  try {
    const revenue = await Payment.aggregate([
      { $match: { status: 'SUCCESS' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paid_at' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    res.json({ success: true, data: revenue })
  } catch (error) { next(error) }
}

const getCompanyAnalytics = async (req, res, next) => {
  try {
    const companyId = req.params.companyId || req.entityId
    if (req.entityType !== 'admin' && String(companyId) !== String(req.entityId)) { res.status(403); throw new Error('Not allowed') }
    const discounts = await Discount.find({ company_id: companyId })
    const discountIds = discounts.map(d => d._id)
    const totalViews = discounts.reduce((sum, d) => sum + (d.views || 0), 0)
    const totalUses = discounts.reduce((sum, d) => sum + (d.uses || 0), 0)
    const scans = await UserScan.countDocuments({ discount_id: { $in: discountIds } })
    res.json({ success: true, data: { totalDiscounts: discounts.length, totalViews, totalUses, totalScans: scans, discounts } })
  } catch (error) { next(error) }
}

const getDiscountUsageDetail = async (req, res, next) => {
  try {
    if (req.entityType !== 'admin') {
      const d = await Discount.findById(req.params.id).lean()
      if (!d) { res.status(404); throw new Error('Discount not found') }
      if (req.entityType !== 'company' || String(d.company_id) !== String(req.entityId)) { res.status(403); throw new Error('Not allowed') }
    }
    const scans = await UserScan.find({ discount_id: req.params.id }).populate('user_id', 'name email').sort('-scanned_at')
    res.json({ success: true, data: scans })
  } catch (error) { next(error) }
}

module.exports = { getDashboardStats, getRevenueDetails, getCompanyAnalytics, getDiscountUsageDetail }
