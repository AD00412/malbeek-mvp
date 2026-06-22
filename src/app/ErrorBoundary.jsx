import { Component } from 'react'
import CompassMark from '../components/CompassMark'

/**
 * حد أمان أعلى التطبيق: يلتقط أي خطأ عرض غير متوقع فيعرض شاشة لطيفة بدل
 * شاشة بيضاء. مقاوم للقفل + أداة تشخيص:
 *  • «جرّب مرة ثانية» تعيد الضبط بلا reload (تتعافى الأخطاء العابرة).
 *  • إعادة ضبط تلقائية عند تغيّر المسار فلا يقفل مسار واحد التطبيق كله.
 *  • يحفظ تفاصيل آخر خطأ في localStorage (يبقى بعد التحديث) ويعرضها قابلةً
 *    للنسخ — حتى يصوّرها المستخدم ونعرف السبب الجذري بدقة.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null, showDetails: false, copied: false }
    this.reset = this.reset.bind(this)
    this.onNav = this.onNav.bind(this)
    this.copy = this.copy.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    const detail = {
      msg: String(error?.message || error),
      stack: String(error?.stack || '').slice(0, 1500),
      componentStack: String(info?.componentStack || '').slice(0, 1500),
      url: (typeof location !== 'undefined' ? location.pathname + location.search : ''),
      ua: (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      at: new Date().toISOString(),
    }
    this.setState({ info: detail })
    // eslint-disable-next-line no-console
    console.error('خطأ غير متوقع في الواجهة:', error, detail.componentStack)
    try { localStorage.setItem('mlk:last-error', JSON.stringify(detail)) } catch { /* تجاهل */ }
  }

  componentDidMount() {
    window.addEventListener('popstate', this.onNav)
  }

  componentWillUnmount() {
    window.removeEventListener('popstate', this.onNav)
  }

  onNav() {
    if (this.state.error) this.setState({ error: null, info: null, showDetails: false })
  }

  reset() {
    this.setState({ error: null, info: null, showDetails: false, copied: false })
  }

  copy() {
    const d = this.state.info || {}
    const text = `ملبّيك — تفاصيل الخطأ\nالرسالة: ${d.msg}\nالمسار: ${d.url}\nالمكوّن: ${d.componentStack}\nالوقت: ${d.at}\nالجهاز: ${d.ua}`
    try {
      navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 1800)
    } catch { /* تجاهل */ }
  }

  render() {
    if (!this.state.error) return this.props.children
    const d = this.state.info || {}
    return (
      <div className="screen-loader" dir="rtl">
        <div className="sl-mark"><CompassMark size={64} /></div>
        <div className="sl-text" style={{ marginTop: 14, fontWeight: 700, color: 'var(--cr-50)' }}>
          صار خطأ غير متوقع
        </div>
        <div className="sl-text" style={{ marginTop: 4, fontSize: 13.5 }}>
          آسفين على هذا — جرّب مرة ثانية، وإذا استمر أعد تحميل الصفحة. بياناتك محفوظة بأمان.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-gold" onClick={this.reset}>جرّب مرة ثانية</button>
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>إعادة التحميل</button>
          <button className="btn btn-ghost" onClick={() => { window.location.href = '/' }}>الرئيسية</button>
        </div>

        {/* تفاصيل تقنية — صوّرها وأرسلها للدعم لنصلح السبب بدقة */}
        <button
          type="button"
          onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
          style={{ marginTop: 22, background: 'transparent', border: 0, color: 'var(--cr-300)',
                   fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>
          {this.state.showDetails ? 'إخفاء التفاصيل التقنية' : 'تفاصيل تقنية (صوّرها وأرسلها للدعم)'}
        </button>
        {this.state.showDetails && (
          <div style={{ marginTop: 12, width: 'min(560px, 92vw)', textAlign: 'right' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={this.copy}>
                {this.state.copied ? 'تم النسخ ✓' : 'نسخ التفاصيل'}
              </button>
            </div>
            <pre style={{ maxHeight: 220, overflow: 'auto', fontSize: 11, lineHeight: 1.6,
                          background: 'var(--surface-2)', border: '1px solid var(--line)',
                          borderRadius: 10, padding: 12, whiteSpace: 'pre-wrap', direction: 'ltr',
                          color: 'var(--cr-200)' }}>
{`الرسالة: ${d.msg || '—'}
المسار: ${d.url || '—'}
المكوّن:${d.componentStack || ' —'}`}
            </pre>
          </div>
        )}
      </div>
    )
  }
}
