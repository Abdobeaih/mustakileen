/**
 * Venues Service: restaurants and entertainment venues from the backend,
 * with the local list as a fallback while the backend is unreachable.
 */
import api from '../api/axios'

const normalize = (item) => ({ ...item, id: item.legacy_id || item._id })

async function fetchList(path) {
  const res = await api.get(path, { timeout: 15000 })
  const list = res.data?.data
  if (!Array.isArray(list) || list.length === 0) throw new Error('empty list')
  return list.map(normalize)
}

export const getRestaurants = () => fetchList('/restaurants')
export const getEntertainmentVenues = () => fetchList('/entertainment')
