// أدوات مساعدة لتعدد الباصات (المرحلة ٢).
import { supabase } from './supabaseClient'
import { seatCount, DEFAULT_ROWS, DEFAULT_BACK } from './busLayout'

/** جلب باصات رحلة مرتبة برقم الباص */
export async function loadTripBuses(tripId) {
  if (!tripId) return []
  const { data } = await supabase
    .from('trip_buses')
    .select('id, bus_number, label, plate, bus_rows, bus_back_row, seating_policy, photo_url')
    .eq('trip_id', tripId)
    .order('bus_number', { ascending: true })
  return data ?? []
}

/** تخطيط باص ({rows, back, policy}) مع قيم افتراضية آمنة */
export function busLayout(bus) {
  return {
    rows: bus?.bus_rows ?? DEFAULT_ROWS,
    back: bus?.bus_back_row ?? DEFAULT_BACK,
    policy: bus?.seating_policy ?? 'all_male',
  }
}

/** إجمالي سعة كل الباصات */
export function totalCapacity(buses = []) {
  return buses.reduce((s, b) => s + seatCount(b.bus_rows ?? DEFAULT_ROWS, b.bus_back_row ?? DEFAULT_BACK), 0)
}

/** اسم عرض للباص */
export function busName(bus) {
  if (!bus) return ''
  return bus.label?.trim() || `باص ${bus.bus_number}`
}
