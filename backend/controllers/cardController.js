const Card = require('../models/Card')

// Never send the full card number back to the browser
const safeCard = (c) => {
  const o = c.toObject ? c.toObject() : { ...c }
  o.card_number = '**** **** **** ' + String(o.card_number || '').slice(-4)
  return o
}

const getMyCards = async (req, res, next) => {
  try {
    const cards = await Card.find({ user_id: req.entityId })
    res.json({ success: true, data: cards.map(safeCard) })
  } catch (error) { next(error) }
}

const saveCard = async (req, res, next) => {
  try {
    if (req.body.is_default) {
      await Card.updateMany({ user_id: req.entityId }, { is_default: false })
    }
    const card = await Card.create({ ...req.body, user_id: req.entityId })
    res.status(201).json({ success: true, data: safeCard(card) })
  } catch (error) { next(error) }
}

const deleteCard = async (req, res, next) => {
  try {
    const card = await Card.findOneAndDelete({ _id: req.params.id, user_id: req.entityId })
    if (!card) { res.status(404); throw new Error('Card not found') }
    res.json({ success: true, message: 'Card deleted' })
  } catch (error) { next(error) }
}

const setDefaultCard = async (req, res, next) => {
  try {
    const card = await Card.findOne({ _id: req.params.id, user_id: req.entityId })
    if (!card) { res.status(404); throw new Error('Card not found') }
    await Card.updateMany({ user_id: req.entityId }, { is_default: false })
    card.is_default = true
    await card.save()
    res.json({ success: true, data: safeCard(card) })
  } catch (error) { next(error) }
}

module.exports = { getMyCards, saveCard, deleteCard, setDefaultCard }
