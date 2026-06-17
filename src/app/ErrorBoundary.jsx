import { Component } from 'react'
import CompassMark from '../components/CompassMark'

/**
 * حدُّ أمانٍ أعلى التطبيق: يلتقط أيّ خطأ عرضٍ غير متوقَّع فيُظهر شاشةً
 * لطيفةً مع زرّ إعادةٍ بدل شاشةٍ بيضاء. لا يعتمد على أيّ سياق.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('خطأٌ غير متوقَّع في الواجهة:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="screen-loader" dir="rtl">
        <div className="sl-mark"><CompassMark size={64} /></div>
        <div className="sl-text" style={{ marginTop: 14, fontWeight: 700, color: 'var(--cr-50)' }}>
          حدث خطأٌ غير متوقّع
        </div>
        <div className="sl-text" style={{ marginTop: 4, fontSize: 13.5 }}>
          نأسف لذلك — أعد تحميل الصفحة لمتابعة عملك. بياناتك محفوظةٌ بأمان.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-gold" onClick={() => window.location.reload()}>
            إعادة التحميل
          </button>
          <button className="btn btn-ghost" onClick={() => { window.location.href = '/' }}>
            الذهاب للرئيسية
          </button>
        </div>
      </div>
    )
  }
}
