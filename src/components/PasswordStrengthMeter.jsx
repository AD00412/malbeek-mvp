import { scorePassword } from '../lib/passwordStrength'

// شريطُ قوّة كلمة المرور — أربع شرائح بألوان ملبّيك الدلاليّة + تلميح.
const COLORS = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--em-500)', 'var(--em-500)']

export default function PasswordStrengthMeter({ password }) {
  if (!password) return null
  const { score, label, suggestions } = scorePassword(password)
  const color = COLORS[score]
  return (
    <div style={{ marginTop: 8 }} aria-live="polite">
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{
            flex: 1, height: 5, borderRadius: 99,
            background: i < score ? color : 'var(--surface-3)',
            transition: 'background .2s',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11.5 }}>
        <span style={{ color, fontWeight: 700 }}>{label}</span>
        {suggestions[0] && <span style={{ color: 'var(--cr-300)' }}>{suggestions[0]}</span>}
      </div>
    </div>
  )
}
