import { Component } from 'react'
import CompassMark from '../components/CompassMark'

/**
 * حدُّ أمانٍ أعلى التطبيق: يلتقط أيّ خطأ عرضٍ غير متوقَّع فيُظهر شاشةً
 * لطيفةً بدل شاشةٍ بيضاء. مقاومٌ للقفل:
 *  • «إعادة المحاولة» تُعيد ضبط الحالة وتُعيد العرض (تتعافى الأخطاء العابرة دون reload).
 *  • يُعيد الضبط تلقائيًّا عند تغيّر المسار (popstate) فلا يَقفِل مسارٌ واحدٌ التطبيقَ كلَّه.
 *  • يحفظ آخر خطأ في sessionStorage للتشخيص، ويُظهر التفاصيل في وضع التطوير.
 * لا يعتمد على أيّ سياق.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reset = this.reset.bind(this)
    this.onNav = this.onNav.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('خطأٌ غير متوقَّع في الواجهة:', error, info?.componentStack)
    try {
      sessionStorage.setItem('mlk:last-error', JSON.stringify({
        msg: String(error?.message || error), at: new Date().toISOString(),
        stack: (info?.componentStack || '').slice(0, 800),
      }))
    } catch { /* تجاهل */ }
  }

  componentDidMount() {
    // أيُّ تنقّلٍ (رجوع/أمام/تغيير مسار) يُعيد ضبط الحدّ فلا يبقى عالقًا.
    window.addEventListener('popstate', this.onNav)
  }

  componentWillUnmount() {
    window.removeEventListener('popstate', this.onNav)
  }

  onNav() {
    if (this.state.error) this.setState({ error: null })
  }

  reset() {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const isDev = (() => { try { return import.meta.env.DEV } catch { return false } })()
    return (
      <div className="screen-loader" dir="rtl">
        <div className="sl-mark"><CompassMark size={64} /></div>
        <div className="sl-text" style={{ marginTop: 14, fontWeight: 700, color: 'var(--cr-50)' }}>
          حدث خطأٌ غير متوقّع
        </div>
        <div className="sl-text" style={{ marginTop: 4, fontSize: 13.5 }}>
          نأسف لذلك — جرّب «إعادة المحاولة»، فإن استمرّ أعد تحميل الصفحة. بياناتك محفوظةٌ بأمان.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-gold" onClick={this.reset}>
            إعادة المحاولة
          </button>
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>
            إعادة التحميل
          </button>
          <button className="btn btn-ghost" onClick={() => { window.location.href = '/' }}>
            الذهاب للرئيسية
          </button>
        </div>
        {isDev && (
          <pre style={{ marginTop: 18, maxWidth: 560, maxHeight: 180, overflow: 'auto', fontSize: 11,
                        opacity: .7, whiteSpace: 'pre-wrap', textAlign: 'left', direction: 'ltr' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
        )}
      </div>
    )
  }
}
