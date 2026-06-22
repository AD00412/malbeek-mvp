import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RatingStars from './RatingStars.jsx'

describe('RatingStars', () => {
  it('يَعرض خمس نجوم', () => {
    render(<RatingStars value={3} />)
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('وضع العرض: الدور img والأزرار معطّلة', () => {
    render(<RatingStars value={3} />)
    expect(screen.getByRole('img')).toBeInTheDocument()
    for (const b of screen.getAllByRole('button')) {
      expect(b).toBeDisabled()
    }
  })

  it('يُفعّل وضع الإدخال عند تمرير onChange ويُبلّغ القيمة المنقورة', async () => {
    const onChange = vi.fn()
    render(<RatingStars value={0} onChange={onChange} />)
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    const stars = screen.getAllByRole('radio')
    await userEvent.click(stars[3]) // النجمة الرابعة
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('readOnly يُلغي التفاعل حتى مع onChange', () => {
    const onChange = vi.fn()
    render(<RatingStars value={2} onChange={onChange} readOnly />)
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })
})
